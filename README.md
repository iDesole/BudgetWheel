# Budget Wheel

On-device budgeting for Android. Income first, then a wheel of every dollar.

The app and home-screen widget share one budget on the device. Nothing is uploaded to a server.

## Run locally

```bash
npm install
npm run dev
```

## Android release

1. Copy `android/keystore.properties.example` to `android/keystore.properties` and fill in your upload keystore.
2. Place the keystore file next to it (do not commit either file).
3. Build:

```bash
npm run bundle:android
```

The signed bundle is written to `android/app/build/outputs/bundle/release/app-release.aab`.

## Play Store kit

Copy in `store/`: listing text, privacy policy, data-safety answers, icon, feature graphic, and screenshots.

## Privacy

See [store/privacy.html](store/privacy.html).
