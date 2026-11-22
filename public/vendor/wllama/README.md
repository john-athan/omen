# wllama 3.8.1

llama.cpp compiled to WebAssembly, for the "In this tab" mind. Shipped as files
rather than loaded from a CDN, so the page runs no script it did not serve.

- Source: `https://registry.npmjs.org/@wllama/wllama/-/wllama-3.8.1.tgz`, whose
  sha512 matches the registry's `dist.integrity`
  (`sha512-Pl7BEJhPU8OHnV/yhn3DFZYhLLOdSHh+4TND79WCftHnlUAdQPAsyc/CfIOY+4mVxvf5VW3Xw3Uf7BBfotS1gw==`).
- Taken unmodified: `package/esm/index.js`, `package/esm/wasm/wllama.wasm` and
  `package/LICENCE` (MIT, Copyright (c) 2024 Xuan Son NGUYEN).

| file | sha256 |
| --- | --- |
| index.js | e5506753e41a59c11f61f2c52422045be9fc76e32a7e47f037aaad5df4ec723e |
| wllama.wasm | 551f13439366eff11e057b1b91fe46a7fdac29d56d67372d4c5f19a549dfe70c |

`tools/validate.sh` fails when either file no longer matches.

## Updating

```sh
curl -sO https://registry.npmjs.org/@wllama/wllama/-/wllama-<version>.tgz
tar xzf wllama-<version>.tgz
cp package/esm/index.js package/esm/wasm/wllama.wasm package/LICENCE public/vendor/wllama/
shasum -a 256 public/vendor/wllama/index.js public/vendor/wllama/wllama.wasm
```

Compare the tarball's sha512 with `npm view @wllama/wllama@<version> dist.integrity`,
then put the new version and hashes here.
