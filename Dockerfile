FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile=false

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

ENV NODE_ENV=production
CMD ["pnpm", "start"]
