// 노을 공중전 컨트롤러 펌웨어
// 보드: ESP32-C3 SuperMini  +  MPU6050(GY-521)  +  버튼 4개
//
// Arduino IDE 설정 (중요!)
//   보드: "ESP32C3 Dev Module"
//   USB CDC On Boot: "Enabled"   <- 이걸 안 켜면 노트북이 신호를 못 받아요
//
// 노트북으로 보내는 한 줄 (초당 약 60번):
//   roll,pitch,버튼1,버튼2,버튼3,버튼4,흔들기
//   예) -12.3,4.5,1,0,0,0,0

#include <Wire.h>
#include <math.h>

// ===== 핀 (배선을 바꾸면 여기만 고치세요) =====
const int PIN_SDA = 6;   // MPU6050 SDA
const int PIN_SCL = 7;   // MPU6050 SCL
// 버튼 한쪽 다리는 아래 핀, 다른 쪽 다리는 GND
const int BTN_PINS[4] = {
  0,  // 오른쪽 위  (빨강)  기관총
  1,  // 오른쪽 아래(파랑)  미사일
  3,  // 왼쪽 위    (흰색)  회피
  4   // 왼쪽 아래  (검정)  경적/부스터
};
const int LED_PIN = 8;   // 보드 내장 LED (LOW = 켜짐)

const uint8_t MPU = 0x68;
const float ACC_SCALE = 8192.0;  // ±4g
const float GYRO_SCALE = 65.5;   // ±500 dps

float roll = 0, pitch = 0;
float gbx = 0, gby = 0;
bool mpuOk = false;
unsigned long lastUs = 0, lastSend = 0, lastErr = 0, shakeUntil = 0, lastRetry = 0;

bool btnState[4] = {false, false, false, false};
bool btnRawPrev[4] = {false, false, false, false};
unsigned long btnChanged[4] = {0, 0, 0, 0};

bool writeReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

bool readRaw(int16_t *v) {
  Wire.beginTransmission(MPU);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)MPU, 14) != 14) return false;
  for (int i = 0; i < 7; i++) {
    uint8_t hi = Wire.read();
    uint8_t lo = Wire.read();
    v[i] = (int16_t)((hi << 8) | lo);
  }
  return true;
}

float wrap180(float a) {
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}

void initMPU() {
  mpuOk = writeReg(0x6B, 0x00)    // 깨우기
       && writeReg(0x1A, 0x03)    // 저역 필터 44Hz
       && writeReg(0x1B, 0x08)    // 자이로 ±500
       && writeReg(0x1C, 0x08);   // 가속도 ±4g
  if (!mpuOk) return;
  delay(100);

  // 자이로 영점 (켜질 때 0.5초 정도 가만히)
  long sx = 0, sy = 0;
  int n = 0;
  int16_t v[7];
  for (int i = 0; i < 150; i++) {
    if (readRaw(v)) { sx += v[4]; sy += v[5]; n++; }
    delay(3);
  }
  if (n > 0) { gbx = sx / (float)n; gby = sy / (float)n; }

  if (readRaw(v)) {
    float ax = v[0] / ACC_SCALE, ay = v[1] / ACC_SCALE, az = v[2] / ACC_SCALE;
    roll = atan2(ay, az) * RAD_TO_DEG;
    pitch = atan2(-ax, sqrt(ay * ay + az * az)) * RAD_TO_DEG;
  }
}

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 4; i++) pinMode(BTN_PINS[i], INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
  initMPU();
  lastUs = micros();
}

void loop() {
  unsigned long nowUs = micros();
  float dt = (nowUs - lastUs) / 1000000.0;
  if (dt < 0.004) return;  // 약 250Hz
  lastUs = nowUs;
  unsigned long nowMs = millis();

  // ----- 기울기 -----
  int16_t v[7];
  if (mpuOk && readRaw(v)) {
    float ax = v[0] / ACC_SCALE, ay = v[1] / ACC_SCALE, az = v[2] / ACC_SCALE;
    float gx = (v[4] - gbx) / GYRO_SCALE;
    float gy = (v[5] - gby) / GYRO_SCALE;
    float accRoll = atan2(ay, az) * RAD_TO_DEG;
    float accPitch = atan2(-ax, sqrt(ay * ay + az * az)) * RAD_TO_DEG;

    roll = wrap180(roll + gx * dt);
    pitch = pitch + gy * dt;

    float mag = sqrt(ax * ax + ay * ay + az * az);
    float k = fabs(mag - 1.0) < 0.3 ? 0.02 : 0.0;  // 흔들 때는 가속도 무시
    roll = wrap180(roll + wrap180(accRoll - roll) * k);
    pitch = pitch + (accPitch - pitch) * k;

    if (fabs(mag - 1.0) > 1.3) shakeUntil = nowMs + 350;
  } else if (nowMs - lastRetry > 1000) {
    lastRetry = nowMs;
    initMPU();  // 센서 다시 연결 시도
  }

  // ----- 버튼 (떨림 방지 8ms) -----
  bool any = false;
  for (int i = 0; i < 4; i++) {
    bool raw = digitalRead(BTN_PINS[i]) == LOW;
    if (raw != btnRawPrev[i]) { btnRawPrev[i] = raw; btnChanged[i] = nowMs; }
    if (nowMs - btnChanged[i] >= 8) btnState[i] = raw;
    any = any || btnState[i];
  }
  digitalWrite(LED_PIN, any ? LOW : HIGH);

  // ----- 전송 -----
  if (nowMs - lastSend >= 16) {
    lastSend = nowMs;
    if (!mpuOk && nowMs - lastErr > 1000) {
      lastErr = nowMs;
      Serial.println("ERR,MPU");
    }
    Serial.printf("%.1f,%.1f,%d,%d,%d,%d,%d\n",
                  mpuOk ? roll : 0.0, mpuOk ? pitch : 0.0,
                  btnState[0], btnState[1], btnState[2], btnState[3],
                  nowMs < shakeUntil ? 1 : 0);
  }
}
