# Builder stage: use Gradle image so we don't need a wrapper in repo
FROM --platform=linux/amd64 gradle:8.7.0-jdk17 AS build
WORKDIR /workspace
COPY . /workspace
# Build without tests for speed/stability in CI; adjust if needed
RUN gradle clean build -x test

# Runtime stage: JDK base image
FROM --platform=linux/amd64 container-registry.oracle.com/java/jdk-no-fee-term:17.0.7-oraclelinux8

VOLUME /tmp
# Copy built jar (exclude plain classifier if present)
COPY --from=build /workspace/build/libs/*.jar /tmp/
RUN mkdir -p /app \
 && ls /tmp/*.jar | grep -v plain | xargs -I '{}' mv '{}' /app/replay.jar

EXPOSE 8082
ENTRYPOINT ["java","-jar","/app/replay.jar"]
