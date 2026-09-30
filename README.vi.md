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
- **Thanh trạng thái** đổi màu theo sức khỏe gateway: chấm xanh = online, vàng = khóa bị từ chối (401/403) hoặc máy chủ lỗi / giới hạn tốc độ, đỏ = không kết nối được, vòng xoay = đang chạy request. Bấm để mở *Thao tác nhanh*; rê chuột xem tooltip (model, context, request gần nhất, token phiên).
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
- **Widget Context Window / compact** theo đúng công thức của VS Code (`maxInput + maxOutput` = cửa sổ thật); usage lấy từ gateway, hoặc tự ước lượng khi gateway không gửi.
- **Giới hạn output** lấy từ máy chủ (`max_completion_tokens` / `capabilities.maxOutput`, tối đa một nửa cửa sổ); `defaultMaxOutputTokens` chỉ áp cho model không khai báo. Lỗi `max_tokens too large` giúp học giới hạn thật và thử lại một lần.
- Học giới hạn context thật từ lỗi tràn; ngân sách token giữ request trong cửa sổ.
- Model không phải chat (ảnh/audio/embedding/rerank…) bị ẩn khỏi bộ chọn; model chỉ có Responses vẫn giữ.

**Model**
- Danh mục đọc từ `/v1/models` (`capabilities`, `context_length`, `max_completion_tokens`).
- Bộ chọn **Thinking effort** (menu con trong bộ chọn model) dựng đúng theo các mức gateway công bố (`capabilities.thinkingRange`), không thêm mức nào; bảng theo format có sẵn chỉ dùng khi gateway không công bố danh sách. Muốn gửi mức mà gateway không quảng bá (ví dụ `max` cho model Claude) thì đặt trong `perModelOptions`. Không chọn sẵn mức nào: cho tới khi anh chọn (hoặc đặt `reasoningEffort` trong `perModelOptions`/`extraModelOptions`) thì không gửi `reasoning_effort`. Model có tier trong id (`...-high`, `...-none`) và model mà gateway bỏ qua mức (MiniMax) không hiện bộ chọn. Không có tùy chọn tắt hẳn thinking.
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
| `defaultMaxTokens` | `262144` | TỔNG cửa sổ context dự phòng (vào + ra) khi máy chủ không báo |
| `defaultMaxOutputTokens` | `4096` | Giới hạn output CHỈ cho model không khai báo (giới hạn đã khai báo luôn ưu tiên) |
| `modelContextWindows` | `{}` | Ghi đè context theo model |
| `perModelOptions` | `{}` | Tham số sampler theo model |
| `enableImageInput` | `true` | Cho phép đính kèm ảnh |
| `visionProxyEnabled` / `visionProxyModel` | `false` / trống | Mô tả ảnh cho model không có vision (thêm một request, có thể dùng model trả phí) |
| `encodeSlashInModelId` | `false` | Hiện `/` trong id model thành `::` (đổi sẽ đặt lại model đã chọn) |
| `requestTimeout` | `60000` | Thời gian chờ request chat (ms) |
| `customHeaders` / `extraModelOptions` | `{}` | Header HTTP thêm / tham số body thêm cho mọi request |
| `probeThinkingLevels` | `true` | Hỏi CLIProxyAPI mức thinking của từng model (xem trên); chỉ dùng với CLIProxyAPI |
| `enableInlineCompletion` | `false` | Gợi ý chữ mờ thử nghiệm (xem bên dưới) |
| `inlineCompletionProvider` / `inlineCompletionModel` | trống | Nhà cung cấp / model trả lời inline completion (*Chọn model inline completion*) |
| `inlineCompletionMaxTokens` / `inlineCompletionDebounce` / `inlineCompletionTimeout` | `256` / `300` / `3000` | Độ dài, khoảng dừng gõ (ms) và timeout (ms) của một request inline |
| `inlineCompletionMaxPrefixChars` / `inlineCompletionMaxSuffixChars` | `4000` / `1000` | Ngữ cảnh gửi trước / sau con trỏ |
| `apiKey` | trống | Bearer token; nên dùng bảng điều khiển hoặc *Quản lý nhà cung cấp* (lưu trong SecretStorage) |

### Thêm gateway thứ hai (ví dụ CLIProxyAPI `http://127.0.0.1:8317/v1`)
*9Router: Thêm nhà cung cấp* (hoặc bảng điều khiển) -> tên, Base URL kết thúc bằng `/v1`, khóa API (lưu trong SecretStorage). Khi có từ hai nhà cung cấp bật, mọi model hiện dạng `<id-nhà-cung-cấp>/<id-model>` nên model đã chọn trước đó có thể phải chọn lại; id đã lưu không có tiền tố vẫn định tuyến về nhà cung cấp mặc định.

**CLIProxyAPI có báo giới hạn thật và extension đọc được.** `/v1/models` kiểu OpenAI của nó chỉ có `{id, object, owned_by}`, nhưng cùng URL đó kèm header `anthropic-version` sẽ trả thêm `max_input_tokens` (cửa sổ context) và `max_tokens` (giới hạn output) cho mọi model, id không phải Claude bị đổi thành `claude-fable-5-dd-<id đảo ngược>`. Khi có model chưa biết context, extension gửi thêm đúng một request đó (cache 5 phút, lỗi thì im lặng), giải mã id và chỉ điền phần gateway chưa tự báo. Gateway đã báo context (9Router) thì không bị hỏi thêm. Cửa sổ được hiểu là tổng (vào + ra): chính xác với Claude, nghiêng về phía an toàn với GPT/Gemini.

**Mức thinking trên CLIProxyAPI.** Không danh sách model nào của CLIProxyAPI mang thông tin này, nhưng nó kiểm tra từng request theo model và nêu các mức nhận được khi gặp mức không nhận (`valid levels: low, medium, high, max`). Chỉ với CLIProxyAPI (nhận biết qua id bị đảo ngược) extension hỏi đúng một lần cho mỗi model ở chế độ nền (một request với mức không hợp lệ và `max_tokens: 1`; một số model xử lý nó như request thật 1 token - 4/33 trên gateway đã kiểm), rồi bộ chọn **Thinking effort** hiện đúng danh sách gateway tự khai cho model đó - khác nhau theo model (`claude-opus-4-6` không có `xhigh`, `gpt-5.5` không có `max`). Các mức chuẩn khác cũng được nhận nhưng gateway làm tròn về mức gần nhất trong danh sách, nên không đưa ra. Model trả lời không có danh sách (2 id Claude trên gateway đã kiểm, và model không hỗ trợ mức) thì không có bộ chọn; dùng `perModelOptions` cho các model đó. Kết quả được nhớ 24 giờ, kể cả qua các lần khởi động lại (theo URL gateway, không lưu gì bí mật); khởi động lại trong khoảng đó thì không gửi request nào. Tắt bằng `probeThinkingLevels: false`.

Gateway không báo giới hạn theo kiểu nào (chỉ `{id, object, owned_by}`) sẽ dùng giá trị dự phòng: context = `defaultMaxTokens`, output = `defaultMaxOutputTokens`, không có bộ chọn thinking. Với các model đó: tăng `defaultMaxOutputTokens` (ví dụ `32768`; giới hạn đã khai báo ở gateway khác vẫn ưu tiên), ghim cửa sổ thật bằng `modelContextWindows` (ví dụ `{"claude-*": 200000}`) và đặt mức effort trong `perModelOptions` (ví dụ `{"gemini-3.8-flash-high": {"reasoningEffort": "high"}}`). Dòng trông như model ảnh/audio/embedding (`gpt-image-*`, `dall-e*`, `whisper*`, ...) chỉ bị ẩn khi dòng đó không có metadata nào. Gateway vẫn có thể liệt kê model mà upstream đã ngừng phục vụ (404/503); ẩn bằng `modelFilter`, ví dụ `^(?!claude-(opus-4-2|opus-4-1|sonnet-4-2|3-))`.

### Vision proxy (thử nghiệm)
Chỉ chạy khi máy chủ báo rõ `capabilities.vision: false` cho model. Tốn thêm một request cho mỗi tin nhắn có ảnh (`visionProxyModel`, hoặc model vision rẻ được tự chọn). Nếu lỗi, ảnh thành `[Image Description unavailable]` và chat vẫn tiếp tục.

## Lệnh

`Thao tác nhanh` · `Mở dashboard 9Router` · `Mở bảng điều khiển 9Router` · `Quản lý nhà cung cấp` · `Thêm nhà cung cấp` · `Kiểm tra kết nối máy chủ` · `Làm mới danh sách model` · `Sửa custom header` · `Chọn model cho inline completion` · `Xem nhật ký (Output)` · `Mở thư mục request dump` · `Xóa khóa API` · `Mở cài đặt`.

## Xử lý sự cố

- **Không thấy model?** Mở bảng điều khiển: chấm cho biết gateway có kết nối được không. `curl <server-url>/models` phải liệt kê model. Chạy *Kiểm tra kết nối máy chủ*; bật `debugMode: metadata` rồi xem *Xem nhật ký*.
- **Tool bị in ra dạng chữ?** `agentTemperature: 0`, tắt `parallelToolCalling`, bật auto tool choice trên máy chủ (vLLM: `--enable-auto-tool-choice`).
- **Tràn context?** Thêm model vào `modelContextWindows`; tiện ích cũng tự học giới hạn từ lỗi và thử lại một lần.
- **Mỗi model hiện hai lần?** Đã sửa ở bản này (vendor không còn khai `configuration` của VS Code). VS Code resolve vendor một lần cho mỗi nhóm trong `chatLanguageModels.json`, và tự tạo nhóm đó khi anh chọn một tùy chọn theo model như mức thinking; nhóm này giờ vô hại và có thể để nguyên.
- **Không thấy bộ chọn thinking ở một model?** Hoặc id model đã chứa tier, hoặc gateway không báo `thinkingRange`/format cho nó, hoặc là model MiniMax. Bật `debugMode: metadata` và xem *Output Log*.
- **Model không có trong danh sách (ví dụ model mới ra)?** Danh sách là những gì gateway trả về từ `/v1/models`. Thêm model trong dashboard 9Router rồi chạy *Làm mới danh sách model*.
- **Cửa sổ Copilot Agents?** Bản này không hỗ trợ (cần API VS Code thử nghiệm).

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

Kiểm tra với gateway thật: `npm run smoke` (kích hoạt trong VS Code cô lập) và `NINEROUTER_API_KEY=... node scripts/probe-thinking.cjs` (request thật theo từng mức thinking).

## Giấy phép và ghi công

MIT. Tác phẩm phái sinh từ [arbs-io/github-copilot-llm-gateway](https://github.com/arbs-io/github-copilot-llm-gateway), [hotrungnhan/9router-for-github-copilot](https://github.com/hotrungnhan/9router-for-github-copilot), [Vizards/deepseek-v4-for-copilot](https://github.com/Vizards/deepseek-v4-for-copilot) và [diegosouzapw/OmniCopilot](https://github.com/diegosouzapw/OmniCopilot). Mọi thông báo bản quyền được giữ trong [LICENSE](LICENSE) và [NOTICE](NOTICE).
