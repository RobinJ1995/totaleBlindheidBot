FROM php:7.4-apache

RUN apt-get update \
	&& apt-get install -y cron

RUN echo "* * * * * php /cron.php 2>/dev/null" > /etc/cron.d/totale-blindheid-bot-cron
RUN crontab

RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

COPY . /var/www/html/
RUN mkdir /var/www/html/telegram/
RUN ln -s /var/www/html/ /var/www/html/telegram/totaleBlindheid

WORKDIR /
RUN echo "#!/bin/bash" >> docker-entrypoint.sh
RUN echo "set -ex" >> docker-entrypoint.sh
RUN echo "cron" >> docker-entrypoint.sh
RUN echo "apache2-foreground" >> docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

CMD ["/docker-entrypoint.sh"]
