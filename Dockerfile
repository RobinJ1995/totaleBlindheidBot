FROM php:7.4-apache

RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

COPY . /var/www/html/
RUN mkdir /var/www/html/telegram/
RUN ln -s /var/www/html/ /var/www/html/telegram/totaleBlindheid

