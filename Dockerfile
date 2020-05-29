FROM maven:3.6.3-openjdk-15 AS build

WORKDIR /build
COPY pom.xml .
RUN mvn install

COPY . .
RUN mvn package -Dmaven.test.skip=true

FROM openjdk:15

WORKDIR /app
COPY --from=build /build/target/totaleblindheid-fat.jar totaleblindheid.jar

CMD ["java", \
#	"-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005", \
	"-Xms32M", \
	"-Xmx64M", \
	"-Xlog:gc", \
	"-jar", \
	"totaleblindheid.jar"]
