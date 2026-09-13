# Vite+ Monorepo Starter

A starter for creating a Vite+ monorepo.

## Development

- Check everything is ready:

```bash
vp run ready
```

- Run the tests:

```bash
vp run -r test
```

- Build the monorepo:

```bash
vp run -r build
```

- Run the development server（选择具体应用）:

```bash
vp run watch-blive#dev      # Electron 桌面应用
vp run @cieljs/chorus#dev   # 多人语音聊天应用
```
