FROM tvdstaaij/nocto


COPY plugin plugins/totale-blindheid
COPY nocto-config.js config/local.js

WORKDIR plugins/totale-blindheid
# Base image lowers the privileges, meaning we can't `npm install` without going back up to root
USER root
RUN chown node -Rc .
USER node
RUN npm install -d
WORKDIR ../..

USER node