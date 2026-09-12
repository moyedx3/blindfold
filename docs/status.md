# Blindfold 현황판: 완료 · 검증됨 · 남은 일

> 마지막 갱신 2026-09-12, main `41f131a`. 팀의 단일 현황판이다. 무언가를 끝내면 여기 체크박스를 채우고
> `날짜 · 커밋 · 증거 위치`를 항목 뒤에 적는다. 배경은 [`guide.md`](guide.md), 배포 절차는
> [`../deploy/README.md`](../deploy/README.md), 발표 문구와 한계는 [`demo-readiness.md`](demo-readiness.md).
> 지갑 주소, seed, 복구 파일, `.env` 내용은 이 파일에도 커밋에도 절대 적지 않는다.

## 한 줄 답

**로컬 데모는 완성됐고 검증됐다. 제출용 데모(공개 테스트넷 + 실제 TEE + 실제 지갑 두 개)는 아직이다.**
남은 일은 전부 외부 자원(자금 있는 지갑, Phala 계정, GHCR)이 필요한 릴리스 단계다. 섹션 3을 순서대로 하면 된다.

## 1. 무엇이 어디까지 됐나

| 영역 | 구현 | 검증됨 (어떻게, 언제) | 미검증 / 한계 |
|---|---|---|---|
| Compact 컨트랙트 `contract/` | 완료 | 로컬 devnet 6케이스 flow 테스트: 등록, 중복 거부, 구매·에스크로, 부족 결제 거부, 타인 출금 거부, 크리에이터 출금. 2026-09-12 재확인 | Preprod에 배포한 적 없음 |
| TEE 인덱서 `indexer/` | 완료 | 단위 62개, devnet E2E(구매 → 봉인된 키 전달), dstack 시뮬레이터 연동 테스트, Docker 이미지 빌드 | **실제 Phala CVM/TDX에서 실행한 적 없음.** 지금까지 모든 실행은 `quote_hex: "dev"` |
| 공용 지갑 패키지 `packages/midnight-web/` + 구매자 앱 `buyer/` | 완료 | 단위 14 + 25, fake-wallet Playwright smoke, **실제 Lace로 구매·언락 (2026-09-05, 로컬 devnet, 약 20초)** | 1AM 지갑은 테스트 안 함 |
| 크리에이터 앱 `creator/` | 완료 | 단위 31, fake-wallet smoke(enclave 키 교체 후 재-provision 포함), attestation 검증기 단위 fixture(TDX 1.0/1.5 report) | **실제 Lace로 돌려본 적 없음.** 실제 TDX quote로 검증기를 돌려본 적 없음 |
| 배포 도구 `deploy/` | 완료 | `npm run demo:local`(컴파일 → devnet → 배포 → 인덱서 → drop 등록·provision), 인덱서 재시작 후 `npm run demo:recover`, 8080 점유 시 즉시 실패. 2026-09-12 확인 | Preprod·Phala 런북은 **한 번도 실행 안 됨**. `deploy/networks.json`은 전부 `null` |
| CI `.github/workflows/ci.yml` | 완료 | main에서 초록: 컴파일, 단위 전체, 빌드 4개, deploy 타입체크, `qa:secrets`, compose config, buyer/creator smoke ([run 34670704713](https://github.com/moyedx3/blindfold/actions/runs/34670704713)) | devnet 테스트는 CI에서 skip (로컬에서만) |
| 문서 | 완료 | README, guide, demo-script, demo-readiness, 검증 기록 | 데모 영상 없음. 저장소 아직 private |

단위 테스트 합계 133개 (contract 1, indexer 62, midnight-web 14, buyer 25, creator 31).

## 2. 검증의 근거

- 2026-09-05: Lane A/B 머지. 실제 Lace 구매 기록은 `guide.md` 7b와 `spike/NOTES.md`.
- 2026-09-10/11: 로컬 devnet 배포·재시작 복구 기록 [`deployment-verification-2026-09-11.md`](deployment-verification-2026-09-11.md).
- 2026-09-12: Lane C/D + 복구 기능 전체 리뷰 후 main 머지. 리뷰에서 나온 attestation 우회 훅 제거, TDX 1.5 report 지원,
  creator secret 덮어쓰기 방지, `public_logs=false`, devnet 재기동 후 지갑 sync 멈춤 수정이 함께 들어갔다.
  133 단위, 두 smoke, `demo:local`, contract flow, indexer E2E, 재시작 복구 모두 통과.

## 3. 남은 일 (이 순서대로)

각 블록에 담당자를 적고, 끝나면 체크와 함께 증거를 남긴다. 마감은 제출 2026-09-28 00:00 KST 기준 역산.

### A. 로컬 devnet에서 실제 지갑 두 개로 처음부터 끝까지 (이번 주. 외부 자원 불필요) — 담당: ___

지금까지 크리에이터 앱은 fake wallet으로만, 구매자 앱은 CLI로 등록한 drop만 실제 Lace로 샀다. 두 앱을 실제 지갑으로 이어서 돌린 적이 없다.

- [ ] Lace 프로필 두 개(크리에이터, 구매자), 둘 다 네트워크 **Undeployed**, proof server **Local (http://localhost:6300)**.
- [ ] `npm run demo:local`로 스택을 올리고, 두 지갑의 주소를 genesis 지갑에서 fund: `npm run fund -w contract -- <mn_addr…> <mn_shield-addr…> 1000 --network undeployed` (Preprod 지갑을 준비한 뒤로는 상태 파일의 기본 네트워크가 preprod라 `--network`를 꼭 붙인다)
- [ ] 크리에이터 앱 `VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev -w creator` (5175): dev mode 체크 → 파일 선택 → Encrypt + Register + Provision. 복구 파일이 내려받아지는지, 카탈로그(`/catalog`)에 뜨는지.
- [ ] 구매자 앱 `VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev -w buyer` (5173): 구매 → 언락 → 복호화된 파일이 원본과 같은지.
- [ ] 크리에이터 앱에서 Escrowed purchases → Withdraw 성공.
- [ ] `npm run demo:stop` 후 인덱서만 다시 띄우고, 크리에이터 앱 "Restore an existing drop"에 복구 파일을 넣어 등록 tx 없이 재-provision 되는지.
- [ ] 크리에이터 secret export → 브라우저 저장소 비움 → import → 같은 drop의 withdraw가 되는지. 다른 secret import 시 확인창이 뜨는지.
- [ ] 결과를 `docs/deployment-verification-<날짜>.md`로 기록.

### B. 공개 테스트넷 지갑 준비 (권장 9/15 시작, 늦어도 9/24) — 담당: ___

DUST가 쌓이는 데 시간이 걸리므로 가장 먼저 시작한다.

- [ ] 배포 지갑: `npm run wallet:prepare -w contract -- --network preprod` → 복구 구문을 레포 밖에 백업 → 출력된 주소를 faucet(<https://midnight-tmnight-preprod.nethermind.dev/>)에서 fund → Lace(Preprod)로 import → NIGHT를 DUST 생성에 등록 → DUST 양수 확인.
- [ ] 크리에이터용, 구매자용 Lace Preprod 지갑도 각각 fund + shield + DUST.
- [ ] 세 지갑 잔액을 데모 전날 다시 확인.

### C. Preprod 컨트랙트 배포 (B 다음) — 담당: ___

- [ ] `npm run deploy -w contract -- --network preprod` → 출력된 64-hex 주소 기록.
- [ ] `npm run ledger -w contract -- <주소> --network preprod` 로 조회 (주소를 `--network`보다 먼저).
- [ ] <https://preprod.midnightexplorer.com/> 에서 배포 tx 확인.
- [ ] `deploy/networks.json`의 `preprod.contract_address`에 **검증한 값만** 기록하고 커밋.

### D. Phala CVM 배포와 실제 TDX 검증 (C와 병렬 시작 가능. Phala 계정·크레딧, GHCR 필요) — 담당: ___

외부 의존이 가장 많은 구간이라 여기서 막히면 E와 F가 밀린다. 절차는 `deploy/README.md`의 "Build and publish the indexer image"와 "Phala CVM".

- [x] 인덱서 이미지 빌드·GHCR push — 2026-09-12 · main `0bd5134` · Actions **release-image** [run 34671670491](https://github.com/moyedx3/blindfold/actions/runs/34671670491), `ghcr.io/moyedx3/blindfold-indexer@sha256:2b09efbe6f99e8eb89b1ee31da5416ff980c14432bf1ebbc56b830fa5ab4d4e3` (linux/amd64). 아직 attestation 검증 전이라 `networks.json`에는 넣지 않았다.
- [x] GHCR 패키지 public 전환 — 2026-09-12 (익명 digest pull 200). 대안으로 남겨둔 방법: 레포가 private인 동안, 레포가 public이 될 때까지는 `deploy/cvm/.env`에 `DSTACK_DOCKER_USERNAME`, `DSTACK_DOCKER_PASSWORD`(read:packages PAT), `DSTACK_DOCKER_REGISTRY=ghcr.io`를 넣어 encrypted env로 전달 ([Phala 문서](https://docs.phala.com/phala-cloud/cvm/create-with-private-docker-image)).
- [x] `npx phala login` — 2026-09-12, 프로필 `moyed-5e6feas-projects`.
- [x] `phala deploy` — 2026-09-12 · CVM `ba917fac-0e75-45d5-8572-870b22c51cd7`, tdx.small(prod5, US-WEST-1, $0.06/h), endpoint `https://94ef50c5719468f34cdb06e000e8f3ee415f0429-8080.dstack-pha-prod5.phala.network`. CONTRACT_ADDRESS는 아직 64자리 0(자리표시자). 인덱서는 컨트랙트를 못 읽어도 뜨도록 고쳐서(main `0bd5134`) health/attest는 서비스 중. C가 끝나면 `.env`의 CONTRACT_ADDRESS만 바꾸고 `deploy/cvm`에서 `phala deploy`로 갱신.
- [x] `/attest`가 진짜 quote(10,020 hex, TDX 1.5) 반환 — 2026-09-12. `/contract`는 아직 자리표시자 주소.
- [x] `npm run attest:inspect -- <endpoint>` 통과 — 2026-09-12: `UpToDate`, report_data 바인딩 ok, RTMR3 `0b2236ad…8468` (Phala `cvms attestation`의 tcb_info와 일치).
- [x] RTMR3, endpoint, image digest를 `deploy/networks.json`에 기록 — 2026-09-12. `contract_address`는 null 유지.
- [ ] `npm run smoke:live` 통과 — C(Preprod 컨트랙트)가 끝나야 가능. 현재는 contract_address가 null이라 스크립트가 시작 단계에서 멈춘다.
- [ ] CVM 재시작 후 RTMR3가 그대로인지, 이미지를 다시 빌드하면 바뀌는지 확인. 바뀌면 재핀 + 재-provision. **주의:** Phala 문서상 RTMR3에는 compose-hash뿐 아니라 app-id, instance-id, key-provider가 함께 들어간다. 즉 RTMR3 핀은 "이 CVM 인스턴스"를 고정하는 것이라 CVM을 새로 만들면 무조건 바뀐다. 데모용 단일 인스턴스에는 문제없지만 발표에서는 "인스턴스 핀"이라고 정확히 말한다.
- [x] 실제 quote를 크리에이터 검증기 코드로 통과 — 2026-09-12: 위 quote를 `creator/test/fixtures/phala-attest-2026-09-12.json`에 저장하고 `LIVE_QVL=1 npx vitest run test/live-quote.test.ts`(creator/)로 `verifyQuote` + `validateVerifiedQuote`가 UpToDate·RTMR3·키 바인딩을 통과. 브라우저 자체에서 돌리는 확인은 아래 항목.
- [ ] **브라우저에서 실전 확인:** 크리에이터 앱을 `VITE_INDEXER_URL=<endpoint> VITE_EXPECTED_MEASUREMENT_HEX=<rtmr3>`로 띄워 실제 quote로 provision이 통과하는지. `creator/src/qvl-verifier.ts`는 아직 실제 quote를 본 적이 없다. 실패하면 이슈로 등록하고 `attest:inspect` 결과와 대조.
- [ ] 공개 네트워크에 붙었을 때 dev mode 체크박스가 비활성인지.

### E. 공개 환경에서 A 반복 (C, D 다음) — 담당: ___

- [ ] 크리에이터: Preprod Lace로 등록·provision (endpoint와 RTMR3는 D의 값).
- [ ] 구매자: Preprod Lace로 구매·언락·복호화. explorer에서 지갑 주소가 컨트랙트 인자에 없는 것 확인.
- [ ] 크리에이터 withdraw.
- [ ] 기록을 남기고, `README.md` 상태 문단을 갱신.

### F. 제출물 (9/26까지) — 담당: ___

- [ ] 데모 영상: [`demo-script.md`](demo-script.md) 순서대로, 검증된 릴리스에서 녹화.
- [ ] `README.md` 상태 문단과 `deploy/networks.json` 최종 확인. `null`이 남아 있으면 그 부분은 "미배포"로 적는다.
- [ ] 저장소 public 전환(심사 요건), 협업자·시크릿 스캔 한 번 더 (`npm run qa:secrets`, `git log -p | grep -i seed` 같은 수동 확인).
- [ ] 제출 폼 (마감 2026-09-28 00:00 KST).

### G. 하면 좋은 것 (필수 아님)

- [ ] 실제 TDX quote 하나를 fixture로 저장해 `creator/test`에서 `verifyQuote` 실전 경로를 회귀 테스트.
- [ ] `deploy/scripts/smoke-live.ts`가 preprod만 받는다. Preview로 갈 경우 스키마 수정.
- [ ] 1AM 지갑으로 구매 한 번. 성공하면 README에서 "Lace만 검증" 문구를 갱신.

## 4. 데모 당일 대비

- Preprod/Phala가 안 되면 로컬 devnet 데모로 대체한다. 이때 attestation은 dev mode라고 명시한다 ([`demo-readiness.md`](demo-readiness.md) "Presenter-safe wording").
- 인덱서 카탈로그는 메모리에만 있다. 인덱서가 재시작되면 구매를 받기 전에 재-provision한다.
- `npm run demo:local` 전에 8080에 남은 프로세스가 없어야 한다(스크립트가 거부한다). `npm run devnet:down`은 로컬 체인을 초기화하므로 컨트랙트를 다시 배포해야 한다.
- 유료 CVM은 테스트·발표 뒤에 끈다.

## 5. 알려진 한계 (고칠 계획 없음. 발표에서 숨기지 않는다)

- 1AM 지갑 미검증, Lace만 검증.
- 복호화 뒤 복사는 막지 못한다. DRM이 아니다.
- shielded 결제는 IP·브라우저 메타데이터를 숨기지 않는다.
- 카탈로그가 in-memory라 재시작마다 재-provision. 이미지가 바뀌면 RTMR3와 provisioning 키가 바뀐다.
- 첫 RTMR3 핀은 trust-on-first-use다. 이미지 digest를 직접 재현해 비교해야 "무슨 코드가 도는지"까지 보증된다.

## 갱신 규칙

- 끝낸 항목은 `- [x] … — 2026-09-XX · <커밋> · <증거: 파일/CI run/explorer 링크>` 형태로.
- 새로 발견한 문제는 섹션 3에 항목으로 추가하고, 고치면 체크한다.
- 지갑 주소, seed, 복구 파일, `.env` 값은 적지 않는다. 컨트랙트 주소와 tx 해시는 괜찮다.
