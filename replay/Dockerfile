# Builder stage: replay is built from this directory, so use a Gradle/JDK 25 image.
FROM --platform=linux/amd64 gradle:9.5.1-jdk25 AS build
WORKDIR /workspace
COPY . /workspace
RUN gradle clean build

# Runtime stage: JRE base image
FROM --platform=linux/amd64 eclipse-temurin:25-jre

VOLUME /tmp
# Copy built jar (exclude plain classifier if present)
COPY --from=build /workspace/build/libs/*.jar /tmp/
RUN mkdir -p /app \
 && ls /tmp/*.jar | grep -v plain | xargs -I '{}' mv '{}' /app/replay.jar

EXPOSE 8082
ENTRYPOINT ["java","-jar","/app/replay.jar"]
