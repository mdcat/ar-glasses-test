# 글래스 핏 AR (프로토타입)

휴대폰/PC 카메라로 얼굴을 인식해 3D 선글라스를 씌워 보는 웹 AR 프로토타입입니다. 앱 설치 없이 브라우저에서 동작합니다.

- 얼굴 추적: Google MediaPipe Face Landmarker (`@mediapipe/tasks-vision@0.10.14`)
- 3D 렌더링: Three.js `0.160.0`
- 안경 모델: `models/sunglasses.glb` (반투명 렌즈의 뿔테 선글라스, 실제 크기 기준 미터 단위)
- 빌드 도구 없음. 라이브러리는 CDN(jsDelivr)에서 불러오므로 인터넷 연결이 필요합니다.

## 파일 구성

```
ar-glasses/
├─ index.html          화면(UI)
├─ app.js              카메라, 얼굴 추적, 3D 렌더링 로직 (상단 CONFIG에서 위치·크기 조정)
└─ models/
   └─ sunglasses.glb   안경 3D 모델
```

## PC에서 실행

`index.html`을 파일로 바로 열면 카메라와 모듈 로딩이 막히므로 간단한 로컬 서버로 띄웁니다.
`localhost`는 HTTPS가 아니어도 카메라를 쓸 수 있습니다.

```bash
cd ar-glasses
npx serve .            # 또는: python3 -m http.server 8000
```

브라우저에서 표시된 주소(예: http://localhost:3000)로 접속한 뒤 **카메라 켜기**를 누르세요.

## 휴대폰에서 실행

휴대폰 브라우저는 **HTTPS 주소에서만** 카메라를 엽니다. 같은 Wi-Fi의 `http://192.168.x.x` 주소로는 열리지 않습니다.
가장 빠른 방법은 로컬 서버를 HTTPS 터널로 여는 것입니다.

```bash
# 터미널 1: 로컬 서버
npx serve . -l 3000

# 터미널 2: HTTPS 임시 주소 발급 (둘 중 하나)
cloudflared tunnel --url http://localhost:3000     # Cloudflare (설치 필요, 계정 불필요)
npx localtunnel --port 3000                        # localtunnel
```

출력된 `https://...` 주소를 휴대폰에서 열면 됩니다. 계속 공유하려면 GitHub Pages, Netlify, Vercel 같은 정적 호스팅에 폴더를 그대로 올리면 됩니다.

## 조정 방법 (`app.js` 상단 `CONFIG`)

| 항목 | 의미 |
|---|---|
| `eyeCornerDistM` | 기준 눈꼬리 거리(m). 값을 키우면 안경이 작아지고, 줄이면 커집니다 |
| `offset` | 미간 기준 안경 위치 보정 `[좌우, 위아래, 앞뒤]` (m) |
| `tiltDeg` | 안경 앞면 기울기 |
| `smoothing` | 떨림 보정 강도. 낮을수록 부드럽고 높을수록 즉각적 |
| `occluder` | 안경다리를 가리는 보이지 않는 머리 모양. 주소 뒤에 `?debug`를 붙이면 초록 와이어프레임으로 보입니다 |

스타일(색상)은 `STYLES` 배열에서 추가·수정할 수 있습니다. glb의 재질 이름이 `TintedLens`이면 렌즈, 나머지는 프레임으로 취급합니다.
다른 glb 모델로 바꾸려면 원점을 브릿지 중앙(렌즈 면), +Y 위, +Z 정면(보는 사람 쪽), 단위 미터로 맞춰 `modelUrl`을 바꾸면 됩니다.

## 알려진 한계

- 첫 실행 시 엔진과 얼굴 모델(약 4MB)을 내려받느라 몇 초 걸립니다.
- GPU 가속이 안 되는 기기는 자동으로 CPU 모드로 전환되며 프레임이 낮아질 수 있습니다.
- 고개를 크게 돌렸을 때(측면)의 안경다리 가림은 단순 타원체 기준이라 귀 위치와 약간 어긋날 수 있습니다.
