# Budget Wheel

Android budgeting application. Income is entered first; spending is shown as a wheel of categories. The app and home-screen widget share on-device storage. There is no account and no server.

<p>
  <img src="store/screenshots/02-wheel.png" width="240" alt="Budget Wheel spending wheel" />
  <img src="store/screenshots/03-graph.png" width="240" alt="Budget Wheel graph" />
</p>

## Features

- Salary or hourly income, US state tax estimate, optional payday weekday for hourly pay
- Category wheel and graph: income, budgeted, spent, money-left, budget-left, out of budget
- Unassigned take-home is Extra Funds
- Home-screen widget (2×2 or 4×2), one-time in-app purchase
- Month, quarter, and year history; PDF and CSV export
- Dark, Light, and System appearance

Take-home figures are planning estimates (single filer, standard deduction), not tax advice.

## Stack

| Layer | Technology |
| --- | --- |
| UI | TypeScript, Vite, CSS (Android WebView) |
| Native | Kotlin — WebView host, App Widget, Play Billing |
| Data | Local JSON. No backend. |
| Export | pdf-lib |

## Repository

```
src/            WebView application
  screens/      onboarding, home, settings, widget preview
  lib/          income, tax estimate, categories, history, export
  store.ts      state and persistence
android/        Kotlin host, widget, billing
store/          Play Console listing assets
scripts/        calendar checks and smoke tests
```

The WebView writes JSON. `BudgetStore` (Kotlin) reads the same file for the widget.

## Development

```bash
npm install
npm run dev
```

```bash
npm run test:calendar
```

## Android release

1. Copy `android/keystore.properties.example` to `android/keystore.properties`.
2. Place the upload keystore beside it. Do not commit either file.
3. `npm run bundle:android`

Output: `android/app/build/outputs/bundle/release/app-release.aab`

Play Console copy and graphics are in `store/`.

## Privacy

Data remains on the device. The Android app does not request `INTERNET`.

- [store/privacy.html](store/privacy.html)
- https://idesole.github.io/budgetwheel-privacy/

## License

Copyright (c) 2026 Chase Wilson. All rights reserved. See [LICENSE](LICENSE).

Outfit is licensed under the SIL Open Font License, Version 1.1. See [NOTICE](NOTICE).

## Contact

Chase Wilson  
[chasewilsonbusiness@gmail.com](mailto:chasewilsonbusiness@gmail.com)
