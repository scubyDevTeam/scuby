# Runtime image only. It packages the jar that backend/build.sh builds (Maven runs in a container there,
# because jOOQ codegen needs the Docker daemon to start Postgres, which a multi-stage build cannot do).
# Build it through backend/build.sh, not by hand: it needs target/scuby-backend-*.jar to exist.
#
# Java version: must match <java.version> in pom.xml and backend/.java-version (change all in one commit).
# The base is pinned to the multi-arch index digest of eclipse-temurin:<JAVA_VERSION>-jre
# (linux/amd64 + linux/arm64), looked up on 2026-10-31. Never copy a digest from a plan or a chat:
#   docker buildx imagetools inspect eclipse-temurin:<JAVA_VERSION>-jre   -> the top-level "Digest:"
# then verify it lists both platforms (`docker buildx imagetools inspect eclipse-temurin:<v>-jre@<digest>`).
ARG JAVA_VERSION=25

FROM eclipse-temurin:${JAVA_VERSION}-jre@sha256:ecdc0adb37bde1a281c4d245a3cd535004b1fc8322d560f5b09463b248c81df0 AS layers
WORKDIR /extract
COPY target/scuby-backend-*.jar app.jar
RUN java -Djarmode=tools -jar app.jar extract --layers --launcher --destination layers

FROM eclipse-temurin:${JAVA_VERSION}-jre@sha256:ecdc0adb37bde1a281c4d245a3cd535004b1fc8322d560f5b09463b248c81df0
RUN groupadd --system scuby && useradd --system --gid scuby --no-create-home --shell /usr/sbin/nologin scuby
WORKDIR /app
# Least to most volatile, so a code change only rewrites the last layer.
COPY --from=layers /extract/layers/dependencies/ ./
COPY --from=layers /extract/layers/spring-boot-loader/ ./
COPY --from=layers /extract/layers/snapshot-dependencies/ ./
COPY --from=layers /extract/layers/application/ ./
USER scuby
EXPOSE 8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60"
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
