# Provider logos

The Bills & Services screens show provider logos in this order:

1. **Official files bundled here.** Put them in `<providerCode>/logo.svg` (or `.png`), for example `mtn/logo.svg`, and register them in `src/content/providerAssets.js` → `LOCAL_LOGOS` with their source.
2. **The logo the ACHIEVER API serves.** This is VTpass's merchant catalogue artwork, fetched only from VTpass hosts and cached by the API.
3. **An ACHIEVER monogram.**

Rules:

- Only add a file you received from the provider (brand/media kit, partner pack) or are otherwise licensed to use. Record where it came from.
- Do not use images found through search engines, images with watermarks, redrawn or AI-generated versions of real brands, or recoloured or distorted marks.
- Keep the original aspect ratio. The UI shows logos with `object-fit: contain` in a square tile, so do not pad or stretch the file.
- The provider codes come from the API (`providerCode`): mtn, airtel, glo, 9mobile, ikedc, ekedc, aedc, kedco, phed, jed, kaedco, eedc, ibedc, bedc, abedc, yedc, dstv, gotv, startimes, showmax, waec, jamb. New providers returned by VTpass work without a file here; they use the API logo or a monogram.
