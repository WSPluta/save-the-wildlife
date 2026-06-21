# Builder stage: use Oracle OpenJDK 25 from OCR to avoid Docker Hub rate limits.
FROM --platform=linux/amd64 container-registry.oracle.com/java/openjdk:25 AS build

ARG GRADLE_VERSION=9.5.1
ADD https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip /tmp/gradle.zip
RUN mkdir -p /opt/gradle \
 && cd /opt/gradle \
 && jar -xf /tmp/gradle.zip \
 && ln -s /opt/gradle/gradle-${GRADLE_VERSION}/bin/gradle /usr/local/bin/gradle \
 && rm /tmp/gradle.zip

WORKDIR /workspace
COPY . /workspace
RUN gradle clean build

FROM --platform=linux/amd64 container-registry.oracle.com/java/openjdk:25

VOLUME /tmp
# Copy built jar (exclude plain classifier if present)
COPY --from=build /workspace/build/libs/*.jar /tmp/
RUN mkdir -p /app \
 && ls /tmp/*.jar | grep -v plain | xargs -I '{}' mv '{}' /app/replay.jar

EXPOSE 8082
ENTRYPOINT ["java","-jar","/app/replay.jar"]
