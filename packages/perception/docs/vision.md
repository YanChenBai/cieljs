# 视觉采样与合成

## 开启与关闭

`vision` 不传或传入 `false` 时完全关闭图片处理，`perception.image` 为 `undefined`：

```ts
const perception = createPerception({ vision: false });
```

启用时传入 `VisionOptions`：

```ts
const perception = createPerception({
  vision: {
    sampleIntervalMs: 5_000,
    differenceThreshold: 0.03,
    maxFrames: 9,
  },
});
```

## 图片输入

```ts
await perception.image?.write({
  source: "livestream", // 默认 "default"
  data: image, // sharp 可读的图片字节
  at: new Date(),
});
```

不同 `source` 独立维护采样时间、差异基准、候选画面和最终合成图。同一来源的写入按顺序串行处理。

## 采样与过滤

每个来源维护以下状态：

| 选项                   | 默认   | 含义                                     |
| ---------------------- | ------ | ---------------------------------------- |
| `sampleIntervalMs`     | 6_666  | 两次候选采样之间的最小间隔（毫秒）       |
| `differenceThreshold`  | 0.03   | 相对上一张已保留画面的平均像素变化阈值   |
| `maxFrames`            | 9      | 每来源合成时最多选择的画面数（1-9）      |

`differenceThreshold` 范围为 0-1，差异基准与上一张**已保留**画面比较，而不是上一张收到的画面。未变化的候选不会替换基准，这避免轻微抖动逐渐累积成一次误判。

## 多帧合成

每组超过 `maxFrames` 时均匀选择画面，并始终保留首尾帧。每组生成一张 1920×1080 的 JPEG 多帧合成图：三列网格、黑底，每格按画面原始宽高比缩放居中。
