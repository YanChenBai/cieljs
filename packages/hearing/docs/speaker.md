# 说话人与声纹

## 声纹文件

声纹是归一化后的说话人 embedding，使用自定义二进制格式保存：

```text
magic "CIELVP01" + uint32 维度 + float32[] embedding
```

读取时重新归一化，维度必须与 speaker 模型一致。文件放在包目录下的 `voiceprints/`，路径会被限制在该目录内，禁止逃逸到目录之外。

## 注册说话人

构造 `ASR` 时传入 `speaker`：

```ts
const asr = new ASR({
  speaker: [{ name: "alice", file: "alice.voiceprint" }],
});
```

每个 profile 的 `name` 必须非空且唯一。片段命中已注册声纹时，`result.speaker` 就是该名字。已注册中心不随新片段更新。

## 动态聚类

没有命中任何已注册声纹的片段参与动态聚类。相似度低于 `speakerThreshold`（默认 0.6）且动态说话人数量未到 `maxSpeakers`（默认 8）时，创建新中心：

```text
speaker_0
speaker_1
...
```

动态中心用移动平均持续更新，更新权重按 20 次封顶。`maxSpeakers` 只限制动态说话人，已注册声纹不占用这个额度。

匹配使用归一化 embedding 的余弦相似度。阈值越高，越倾向把相近声音拆成不同说话人。

## 生成声纹

```bash
vp run @cieljs/hearing#voiceprint -- --output alice.voiceprint 1.wav 2.wav 3.wav
```

`voiceprint` 接受一个或多个 16 kHz WAV 文件。每个文件独立提取 embedding，最后取平均并归一化成一个声纹。`--output` 必填，结果写入包目录下的 `voiceprints/`，并打印一行 JSON：

```json
{
  "type": "voiceprint",
  "output": "…/voiceprints/alice.voiceprint",
  "samples": 3,
  "dimensions": 192
}
```

`dimensions` 取决于 speaker 模型，当前 3D-Speaker ERes2Net base 为 192。音频采样率必须为 16 kHz，每个文件都要足够长以产生 embedding。声纹生成依赖 speaker 模型，请先安装模型。
