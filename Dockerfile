# Used by docker-compose.yml to deploy the formio application
# (When modified, you must include `--build` )
# -----------------------------------------------------------

FROM node:24-alpine

WORKDIR /app

COPY src/ /app/src/
COPY config/ /app/config/
COPY *.js /app/
COPY *.txt /app/
COPY package.json /app/
COPY default-template.json /app/

COPY portal/src /app/portal/src
COPY portal/public /app/portal/public
COPY portal/package.json /app/portal/package.json
COPY portal/tsconfig.json /app/portal/tsconfig.json
COPY portal/webpack.config.mjs /app/portal/webpack.config.mjs

# native addons (isolated-vm) need a compiler toolchain
RUN apk add --no-cache make python3 g++ git linux-headers \
  && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

# Server + VM bundles (webpack lives in devDependencies)
RUN npm install \
  && npm run build

# Portal UI. Rewrite leftover monorepo "workspace:" specs so npm can resolve.
WORKDIR /app/portal
RUN npm pkg set \
      dependencies.@formio/js="^5.5.2" \
      dependencies.@formio/react="^6.2.1" \
      devDependencies.@formio/core="^2.8.2" \
  && npm install \
  && npm run build

WORKDIR /app
RUN apk del git

ENV DEBUG=""
ENTRYPOINT [ "node", "--no-node-snapshot", "main" ]
