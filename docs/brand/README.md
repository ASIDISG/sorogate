# Brand files

| File | What it is | Where it is used |
| --- | --- | --- |
| [`logo.svg`](logo.svg), [`logo-512.png`](logo-512.png) | The mark: a gate with three conditions in it. | The organization avatar (upload the PNG in the organization's settings), and the page's favicon. |
| [`social-preview.svg`](social-preview.svg), [`social-preview.png`](social-preview.png) | A 1280 by 640 picture of a policy being worked out: three conditions, checked in order, stopping at the first that fails, and the answer with its reason. | The repository social preview (upload the PNG under Settings, Social preview), the organization profile, and the playground's link preview. |

The pictures are illustrations. The policy in them is an example, not a recorded run, and the names in it are not real
assets. The PNG files are rendered from the SVG files at 1280 by 640 and 512 by 512 pixels (for example with
[sharp](https://sharp.pixelplumbing.com): `sharp('social-preview.svg').resize(1280, 640).png()`). The copies in
`packages/site/public` are checked against these files by `packages/site/test/meta.test.ts`, so change them here first.
