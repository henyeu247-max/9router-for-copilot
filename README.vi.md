# 9Router cho GitHub Copilot Chat

Dùng model của **9Router** (và mọi gateway tương thích OpenAI) ngay trong GitHub Copilot Chat: chế độ agent, gọi tool, thinking, vision và tự động dự phòng — kèm chấm trạng thái, bảng điều khiển trên Activity Bar và công cụ gỡ lỗi.

> English: xem [README.md](README.md).

## Bắt đầu nhanh

1. **Cài** tiện ích (`.vsix` hoặc Marketplace).
2. Bấm biểu tượng **9Router** ở Activity Bar (hoặc thanh trạng thái → *Mở bảng điều khiển 9Router*), nhập **URL máy chủ** (mặc định `http://localhost:20128/v1`) và **khóa API** nếu gateway yêu cầu, rồi **Lưu & Kiểm tra**.
3. Trong Copilot Chat mở bộ chọn model → **Manage Models** → bật model dưới **9Router**.
4. Chọn model và chat. Không cần gói Copilot trên VS Code ≥ 1.122.

## Có gì

**Kết nối & giao diện**
- **Bảng điều khiển** Activity Bar: chấm online/offline, số model, form URL + khóa, sức khỏe từng nhà cung cấp, liên kết nhanh.
- **Thanh trạng thái**: bấm để mở *Thao tác nhanh*; rê chuột xem tooltip (model, context, request gần nhất, token phiên).
- **Giám sát sức khỏe**: kiểm tra mỗi nhà cung cấp 30 giây/lần (`healthCheckIntervalSeconds`), phản ứng ngay theo kết quả request.
- **Mở dashboard 9Router** trên trình duyệt hoặc trong tab VS Code (`dashboardOpen: editor`, chỉ khi gateway cho phép nhúng — nếu không sẽ tự mở bằng trình duyệt).
- **Nhiều hồ sơ nhà cung cấp** (local + cloud cùng lúc), khóa lưu trong SecretStorage của VS Code.
- Giao diện tiếng Việt và tiếng Anh.

**Độ bền**
- Sửa JSON tool lỗi; điền các trường bắt buộc còn thiếu.
- Reasoning gom thành **một** khối thinking mỗi lượt (hết cảnh "Finished with N steps").
- Host nghiêm ngặt: tên/id tool dài hơn 64 ký tự được rút gọn khi gửi và ánh xạ ngược lại (chế độ Agent vẫn chạy).
- **429/503** → thử lại theo `Retry-After` / backoff lũy thừa.
- **HTTP 400** → thử lại một lần không có `reasoning_effort`; chỉ bỏ tools khi thông báo lỗi nói tools không được hỗ trợ. Không bao giờ thử lại sau khi đã hiện kết quả.
- Học giới hạn context thật từ lỗi tràn; ngân sách token giữ request trong cửa sổ.
- Model không phải chat (ảnh/audio/embedding/rerank…) bị ẩn khỏi bộ chọn; model chỉ có Responses vẫn giữ.

**Model**
- Danh mục đọc từ `/v1/models` (`capabilities`, `context_length`, `max_completion_tokens`).
- `modelFilter` (regex/chuỗi con), `modelContextWindows`, `perModelOptions`.
- **Vision proxy** tùy chọn cho model không có vision; mã hóa id `::` tùy chọn.
- Inline completion (ghost-text) thử nghiệm qua `/v1/completions`.

**Gỡ lỗi** (`debugMode`)
- `off` (mặc định) · `metadata` (chỉ kích thước/vai trò/tên tool) · `verbose` (toàn bộ request; khóa API **luôn được che**).
- Dump nằm trong thư mục lưu trữ của tiện ích (giữ 50 file mới nhất): *9Router: Mở thư mục request dump*.
- `verboseLogging: true` cũ vẫn được hiểu là *verbose*.

## Cài đặt chính

Tiền tố: `9router-for-github-copilot.`

| Cài đặt | Mặc định | Tác dụng |
| --- | --- | --- |
| `serverUrl` | `http://localhost:20128/v1` | URL gateway (đuôi `/v1` không bắt buộc) |
| `statusBar` | `true` | Hiện mục trên thanh trạng thái |
| `healthCheckIntervalSeconds` | `30` | Chu kỳ kiểm tra sức khỏe (tối thiểu 5) |
| `dashboardOpen` / `dashboardUrl` | `external` / trống | Mở dashboard ở đâu/địa chỉ nào (trống = gốc máy chủ) |
| `debugMode` | `off` | `off` / `metadata` / `verbose` |
| `modelFilter` | trống | Regex/chuỗi con lọc id model (bộ lọc không khớp gì sẽ bị bỏ qua + ghi log) |
| `enableToolCalling` / `parallelToolCalling` | `true` | Tool cho agent |
| `agentTemperature` | `0` | Độ ổn định khi gọi tool |
| `defaultMaxTokens` / `defaultMaxOutputTokens` | `262144` / `4096` | Giới hạn dự phòng |
| `modelContextWindows` | `{}` | Ghi đè context theo model |
| `perModelOptions` | `{}` | Tham số sampler theo model |
| `enableImageInput` | `true` | Cho phép đính kèm ảnh |
| `visionProxyEnabled` / `visionProxyModel` | `false` / trống | Mô tả ảnh cho model không có vision (thêm một request, có thể dùng model trả phí) |
| `encodeSlashInModelId` | `false` | Hiện `/` trong id model thành `::` (đổi sẽ đặt lại model đã chọn) |

### Vision proxy (thử nghiệm)
Chỉ chạy khi máy chủ báo rõ `capabilities.vision: false` cho model. Tốn thêm một request cho mỗi tin nhắn có ảnh (`visionProxyModel`, hoặc model vision rẻ được tự chọn). Nếu lỗi, ảnh thành `[Image Description unavailable]` và chat vẫn tiếp tục.

## Lệnh

`Thao tác nhanh` · `Mở dashboard 9Router` · `Mở bảng điều khiển 9Router` · `Quản lý nhà cung cấp` · `Thêm nhà cung cấp` · `Kiểm tra kết nối máy chủ` · `Làm mới danh sách model` · `Sửa custom header` · `Chọn model cho inline completion` · `Xem nhật ký (Output)` · `Mở thư mục request dump` · `Xóa khóa API` · `Mở cài đặt`.

## Xử lý sự cố

- **Không thấy model?** Mở bảng điều khiển: chấm cho biết gateway có kết nối được không. `curl <server-url>/models` phải liệt kê model. Chạy *Kiểm tra kết nối máy chủ*; bật `debugMode: metadata` rồi xem *Xem nhật ký*.
- **Tool bị in ra dạng chữ?** `agentTemperature: 0`, tắt `parallelToolCalling`, bật auto tool choice trên máy chủ (vLLM: `--enable-auto-tool-choice`).
- **Tràn context?** Thêm model vào `modelContextWindows`; tiện ích cũng tự học giới hạn từ lỗi và thử lại một lần.
- **Cửa sổ Agents?** Chạy ở tiến trình riêng: thêm `"extensions.supportAgentsWindow": { "henyeu247-max.9router-for-github-copilot": true }` rồi reload.

## Quyền riêng tư

Prompt và code chỉ gửi tới **gateway của anh**. Request dump nằm trên máy anh và không bao giờ chứa khóa API. Bản thân Copilot Chat vẫn có thể liên hệ GitHub cho xác thực/telemetry/đặt tiêu đề — chuyển hướng bằng `chat.utilityModel` / `chat.utilitySmallModel`.

## Phát triển

```bash
npm install
npm run check-types   # tsc --noEmit
npm run lint          # eslint src
npm test              # vitest run
npm run compile       # bundle dev -> dist/
npm run vsix          # đóng gói (build production trước)
```

## Giấy phép và ghi công

MIT. Tác phẩm phái sinh từ [arbs-io/github-copilot-llm-gateway](https://github.com/arbs-io/github-copilot-llm-gateway), [hotrungnhan/9router-for-github-copilot](https://github.com/hotrungnhan/9router-for-github-copilot), [Vizards/deepseek-v4-for-copilot](https://github.com/Vizards/deepseek-v4-for-copilot) và [diegosouzapw/OmniCopilot](https://github.com/diegosouzapw/OmniCopilot). Mọi thông báo bản quyền được giữ trong [LICENSE](LICENSE) và [NOTICE](NOTICE).
