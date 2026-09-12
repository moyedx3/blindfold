# 로컬 데브넷 배포 검증 기록 및 후속 TODO

배포·테스트: 2026-09-10 KST. 서비스 재시작·복구 확인: 2026-09-11 KST.

## 현재 결론

Midnight **로컬 데브넷(`undeployed`) 배포와 실제 체인 테스트를 완료했다.** 공개 Preview/Preprod,
실제 Phala TEE 및 메인넷 배포는 수행하지 않았다. 아래 TODO는 후속 작업 목록이며 배포 실행 승인이 아니다.

## 사용한 코드와 변경 이력

- 저장소: `moyedx3/blindfold`.
- 배포·검증 커밋: `f060804e8b06024dfbbe14708a38de1b873efdc7`.
- 원격 `fix/creator-recovery`의 해당 커밋을 별도 작업 폴더에 받아 검증했다.
- 이 커밋은 원격 `lane-d` 기반으로 A/B/C/D 구현을 포함한다. `main` 병합 완료를 의미하지 않는다.
- 기존 작업 폴더의 미커밋 코드·의존성·컴파일 산출물은 배포에 재사용하지 않았다.
- `0896315`: 크리에이터 콘텐츠 복구 파일(HKDF/AES-GCM), 기존 drop 재-provision,
  dev attestation을 undeployed+loopback으로 제한하는 변경.
- `f060804`: 인덱서 provision 테스트에서 libsodium 준비 후 키를 생성하도록 초기화 순서 수정.
- 위 두 커밋 이후 로컬 배포·서비스 복구 과정에서는 추적 소스 변경이나 추가 커밋·push를 하지 않았다.

## 배포 결과

| 항목 | 결과 |
|---|---|
| 네트워크 | 로컬 Midnight `undeployed` |
| 컨트랙트 | `25e5c13e4921d98c0f677a65b806f4bf670877795a5dc8b1e56eedce999600bd` |
| 구매자 앱 | `http://127.0.0.1:5173` |
| 크리에이터 앱 | `http://127.0.0.1:5175` |
| Blindfold 인덱서 | `http://127.0.0.1:8080` |
| Midnight indexer | `http://127.0.0.1:8088/api/v4/graphql` |
| Midnight node | `http://127.0.0.1:9944` |
| Proof server | `http://127.0.0.1:6300` |
| 데모 | drop 2, `Blindfold demo drop`, 가격 1 NIGHT |
| 데모 등록 tx | `002b15be8dab7d85bb9c29df4aa23221c493f9061a2ea259e22b428cd707e04451` |

주소와 트랜잭션은 해당 로컬 체인에만 해당한다. 공개 explorer에서 조회할 수 없으며 체인 초기화 후에는
유효하지 않을 수 있다. 로컬 URL은 서비스를 실행 중인 PC에서만 접근 가능하다.

## 완료한 검증

| 검사 | 결과 및 범위 |
|---|---|
| GitHub CI | [run 34479512570](https://github.com/moyedx3/blindfold/actions/runs/34479512570) 전체 성공 |
| CI 검사 범위 | Compact 컴파일, 전체 단위 테스트, 앱 빌드, deploy 타입 검사, 비밀정보 출력 검사, compose 설정 검사, buyer/creator 브라우저 smoke |
| 컴파일 | WSL의 Compact 0.31.1로 해당 소스를 새로 컴파일 |
| 로컬 빌드 | indexer, midnight-web, buyer, creator 성공 |
| 배포 조회 | 배포 완료 후 Midnight indexer로 ledger를 읽어 주소와 상태 확인 |
| 실제 체인 contract flow | `contract/test/flow.test.ts` 6개 통과: 등록, 중복 거부, 구매·에스크로, 부족한 결제 거부, 타인 출금 거부, 크리에이터 출금 |
| 실제 체인 indexer E2E | `indexer/test/e2e.devnet.test.ts` 2개 통과: 순수 ID helper 1개와 실제 등록·구매·봉인된 콘텐츠 키 전달 1개 |
| 실행 서비스 | node/indexer/proof-server healthy, 두 앱 및 인덱서 health/contract/catalog 정상 응답 |
| 데모 등록 | 실제 체인에 drop 2 등록 후 실행 중인 인덱서에 콘텐츠 업로드·키 provision |
| 재시작 복구 | 기존 컨테이너를 재시작하고 이전 컨트랙트·drop·purchase 상태 유지 확인. 인덱서 재시작 후 로컬 데모 복구 파일로 drop 2 재-provision, 카탈로그 복원 확인 |

Contract flow 테스트는 테스트용 컨트랙트를 별도로 배포한다. 위 서비스 컨트랙트에는 indexer E2E와
데모 등록을 수행했다. indexer E2E의 HTTP 계층은 `server.inject`로 구동하는 in-process 서버이며,
구매 트랜잭션은 실제 로컬 체인에 전송한다. 같은 genesis 지갑의 서로 다른 private state를 이용했으므로
별도의 두 Lace 지갑을 이용한 사용자 흐름 검증과는 다르다.

CI의 브라우저 smoke는 fake wallet을 사용한다. Creator smoke에는 enclave 키를 바꾼 후 복구 파일로
원래 콘텐츠 키를 재전달하는 검증이 포함된다. 이번 실행에서 새로 확인한 실제 체인 E2E의 종료 조건은
구매자 키로 원래 콘텐츠 키를 여는 것이다. 실사용 브라우저에서 전체 파일 복호화·출금까지 수행한 것으로
확대해서 해석하지 않는다.

## 문제사항과 운영 제한

1. **Windows 실행 권한:** 초기 세션에서 Docker 엔진과 WSL 접근이 거부됐다. 사용자 권한 설정 변경 후
   접근·컴파일·배포가 가능해졌다. 서비스 중단 후에는 Docker와 앱 프로세스를 재실행해야 했다.
2. **지갑 조회 CLI 인자:** `ledger.ts`는 첫 인자를 주소로 해석하므로 `--network`를 먼저 주면 실패한다.
   현재 소스 수정 없이 `npm run ledger -w contract -- <address> --network undeployed`로 조회했다.
3. **실제 TEE 미검증:** 로컬 인덱서는 `quote_hex: "dev"`를 사용한다. 운영자에게 콘텐츠 키가 숨겨진다는
   TEE 보장은 이번 테스트로 입증되지 않았다.
4. **키 복구 운영:** 인덱서의 키 카탈로그는 메모리에만 있다. 재시작 후 재-provision이 필요하다.
   Creator 복구 파일과 원래 creator secret 백업을 모두 보관해야 한다. 새 기능 이전에 이미 잃어버린
   콘텐츠 키는 복구할 수 없다. 로컬 seed-demo 복구 파일과 creator 앱 복구 파일은 별도 형식이다.
5. **테스트 잔여 데이터:** 서비스 컨트랙트의 drop 1/purchase 0은 in-process E2E가 만든 데이터다.
   테스트용 키는 정리되므로 실행 중인 인덱서는 이 drop을 provision하지 못해 대기 로그를 남길 수 있다.
   사용자용으로 제공한 카탈로그 항목은 drop 2다. 공개 배포에는 테스트 전용 컨트랙트를 분리해야 한다.
6. **빌드 경고:** Vite 의존성 최적화 옵션 deprecation, 일부 의존성의 browser externalization 및 WebSocket
   export 경고가 있었다. 빌드와 fake-wallet smoke는 통과했지만 실제 Lace 연결로 확인해야 한다.
7. **CI 산출물:** 컴파일 산출물 업로드를 추가하려던 workflow 변경은 인증의 `workflow` scope 부족으로
   push가 거부됐다. 해당 변경은 검증 커밋에 포함되지 않으며 이번 배포는 WSL에서 직접 컴파일했다.
8. **증거의 한계:** 단위·통합 테스트 통과는 독립 보안 감사나 메인넷 준비 완료를 의미하지 않는다.

지갑 seed/mnemonic, creator secret, 콘텐츠 키, 복구 번들, wallet state, `.env` 및 실행 로그는 이 기록이나
커밋에 포함하지 않는다. 공개 배포 값은 실제 검증 전까지 `deploy/networks.json`에 채워 넣지 않는다.

## 후속 TODO

### 1. 로컬 사용자 흐름 및 복구

- [ ] 별도로 자금을 지급한 creator/buyer Lace 지갑으로 등록 → 구매 → 파일 복호화 → 출금 확인.
- [ ] 등록 후 provision 실패를 유도하고, 페이지 재로드 후 복구 파일로 중복 등록 없이 재전달 확인.
- [ ] 원래 creator secret과 복구 파일의 내보내기·가져오기, 잘못된 secret/네트워크/컨트랙트 거부를 실제 UI에서 확인.
- [ ] 인덱서 재시작 중 발생한 구매의 키 전달 재개 확인. 복구 실패 시 사용자 안내와 운영 절차 점검.
- [ ] 테스트 계약·데모 계약을 분리하고 서비스 시작/종료, 체인 데이터 보존·초기화 절차를 재현 가능하게 정리.

### 2. 공개 테스트넷 배포

- [ ] 실행 시점의 공식 호환성 표와 endpoint를 다시 확인하고 Preview 또는 Preprod 대상으로 버전 고정.
- [ ] 테스트 전용 배포·creator·buyer 지갑의 NIGHT/DUST 준비와 잔액 확인.
- [ ] 검증할 원격 커밋을 확정한 뒤 컴파일하고 컨트랙트 배포. 주소·tx·네트워크·커밋 기록.
- [ ] Midnight indexer 및 해당 공개 explorer에서 배포 상태를 각각 확인.
- [ ] 실제 두 지갑으로 등록·구매·복호화·출금, 부족한 결제·타인 출금 거부 확인.
- [ ] RPC/indexer/proof-server 장애, 재연결, pending tx, 중복 클릭, 페이지 재로드, 체인 reset 대응 점검.

### 3. 공개 TEE 및 서비스 운영

- [ ] Phala에 digest로 고정한 이미지 배포, HTTPS endpoint 및 실제 TDX quote 확보.
- [ ] QVL `UpToDate`, RTMR3 pin, `report_data`와 provisioning pubkey 결합 검증.
- [ ] `deploy/networks.json`에 검증한 공개 값만 기록하고 `npm run smoke:live` 통과.
- [ ] CVM 재시작·재배포·measurement 변경 후 creator 복구 및 미전달 구매 재처리 확인.
- [ ] 공개 네트워크에서 dev quote 우회가 차단되는지 실제 배포 빌드로 확인.
- [ ] 콘텐츠 업로드 용량·빈도 제한, 서비스 모니터링, 저장 공간, 암호화 백업·복원 및 비용 점검.

### 4. 메인넷 준비 및 별도 배포

- [ ] 공개 테스트넷과 실제 TEE 검증 결과를 검토하고 남은 결함 해결.
- [ ] 계약 권한·결제·출금, 암호화·복구 파일, TEE 신뢰 경계에 대한 독립 보안 검토 수행.
- [ ] 메인넷 지원 버전·endpoint·지갑·실제 NIGHT/DUST 비용과 운영 자금 관리 절차 확인.
- [ ] 운영 키 관리, 접근 통제, 모니터링·알림, 장애 대응, 재-provision 및 계약 교체 계획 확정.
- [ ] 메인넷 배포 커밋·설정·예산·검증 절차를 제시하고 **별도 명시적 배포 승인** 받기.
- [ ] 승인 후 배포, 온체인 주소·tx 확인, 승인된 소액으로 전체 흐름 검증 및 배포 기록 작성.

메인넷은 이번 로컬 테스트의 자동 다음 단계가 아니다. 공개 테스트넷·TEE·운영 검증을 마친 뒤 판단한다.
