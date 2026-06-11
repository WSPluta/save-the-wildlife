FROM --platform=linux/amd64 eclipse-temurin:25-jdk AS build

RUN mkdir /opt/src 
COPY . /opt/src
WORKDIR /opt/src
RUN ./gradlew clean build

FROM --platform=linux/amd64 eclipse-temurin:25-jre

VOLUME /tmp
COPY --from=build /opt/src/build/libs/*.jar /tmp/
RUN mkdir /app
RUN ls /tmp/*.jar | grep -v plain | xargs -I '{}' mv {} /app/score.jar

ENTRYPOINT ["java","-jar","/app/score.jar"]
