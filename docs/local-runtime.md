# Local runtime notes

This project was created with the supported Sites Vinext starter. Its scripts read ignored `.sites-runtime/execution-profile.json`. The managed environment uses supervised preview and Cloudflare bindings. In a normal checkout the profile file is absent and the framework runner chooses its portable mode. Do not copy `.sites-runtime`, `.wrangler` or `node_modules` into a submission source package.

1. Install Node >=22.13 and pnpm.
2. Run `pnpm install --frozen-lockfile` and `pnpm run build`.
3. Apply `drizzle/0000_puzzling_magneto.sql` to the local D1 database using the command in README.
4. Run `pnpm dev` and use the localhost address printed by the server.
5. The portable starter offers `/signin-with-chatgpt?return_to=/` with a simulated development identity. Development routes also use the clearly labelled local reviewer fallback. The production build removes that fallback and expects platform identity headers.

To reproduce document ingestion, provide the seven original numbered PDFs using `--input`. Do not use a public repository or hosting audience for the restricted corpus. The included rules intentionally target this assessment pack.
