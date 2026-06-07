# docker-bake.hcl — Vireo local multi-service builds.
#
# Run from the repo root:
#
#   docker buildx bake --print all                   # dry-run, show plan
#   docker buildx bake --load all                   # build 12 images into local daemon
#   docker buildx bake --push all --set "*.tags=..." # build + push
#   docker buildx bake node-runtime                  # build only the 9 Node services
#   docker buildx bake python-runtime                # build only the 3 Python services
#   docker buildx bake auth                          # build a single service
#
# Override defaults on the command line, e.g.:
#   TAG=v0.1.0 REGISTRY=ghcr.io OWNER=vireo docker buildx bake --push all
#
# ----------------------------------------------------------------------
# 12 services total:
#   9 Node   : auth, billing, oauth, ingest, dashboard, studio,
#              monitoring, distributor, analyst
#   3 Python : style-learner, editor, video
# ----------------------------------------------------------------------

# ----- user-tweakable inputs -----------------------------------------
variable "TAG" {
  default     = "latest"
  description = "Image tag (overridden in CI by docker/metadata-action)."
}

variable "REGISTRY" {
  default     = "vireo"
  description = "Registry / namespace prefix (e.g. ghcr.io/vireo)."
}

variable "PLATFORMS" {
  default     = ["linux/amd64"]
  description = "Target platforms; CI uses linux/amd64,linux/arm64."
}

# ----- shared defaults applied to every target -----------------------
target "_common" {
  context    = "."
  platforms  = PLATFORMS
  pull       = true
  no-cache   = false
  labels = {
    "org.opencontainers.image.title"       = "Vireo"
    "org.opencontainers.image.vendor"      = "vireo"
    "org.opencontainers.image.licenses"    = "Proprietary"
    "org.opencontainers.image.source"      = "https://github.com/vireo/vireo"
  }
}

# ----- shared base image for all 9 Node services ---------------------
# Uses the repo's docker/node.Dockerfile which installs the full
# workspace once; each service then layers its own source on top.
target "node-base" {
  inherits   = ["_common"]
  dockerfile = "docker/node.Dockerfile"
  tags       = ["${REGISTRY}/node-base:${TAG}"]
  cache-from = [
    "type=registry,ref=${REGISTRY}/node-base:buildcache",
    "type=registry,ref=${REGISTRY}/node-base:latest",
  ]
  cache-to = [
    "type=inline",
  ]
}

# ----- shared base image for all 3 Python services ------------------
# Python agents have per-agent Dockerfiles, but they share the same
# python:3.13-slim base; pin it once here for cache locality.
target "python-base" {
  inherits   = ["_common"]
  dockerfile = "-"
  contexts = {
    # noop; this target exists only to declare the base image
    "scratch" = "target://python-scratch"
  }
  tags = []
}

# ----- 9 Node service images (inherits node-base) -------------------
target "auth" {
  inherits   = ["node-base"]
  dockerfile = "docker/node.Dockerfile"
  tags       = ["${REGISTRY}/auth:${TAG}"]
  args = {
    SERVICE = "auth"
  }
}

target "billing" {
  inherits   = ["node-base"]
  dockerfile = "docker/node.Dockerfile"
  tags       = ["${REGISTRY}/billing:${TAG}"]
  args = {
    SERVICE = "billing"
  }
}

target "oauth" {
  inherits   = ["node-base"]
  dockerfile = "docker/node.Dockerfile"
  tags       = ["${REGISTRY}/oauth:${TAG}"]
  args = {
    SERVICE = "oauth"
  }
}

target "ingest" {
  inherits   = ["node-base"]
  dockerfile = "docker/node.Dockerfile"
  tags       = ["${REGISTRY}/ingest:${TAG}"]
  args = {
    SERVICE = "ingest"
  }
}

target "dashboard" {
  inherits   = ["node-base"]
  dockerfile = "docker/node.Dockerfile"
  tags       = ["${REGISTRY}/dashboard:${TAG}"]
  args = {
    SERVICE = "dashboard"
  }
}

target "studio" {
  inherits   = ["node-base"]
  dockerfile = "docker/node.Dockerfile"
  tags       = ["${REGISTRY}/studio:${TAG}"]
  args = {
    SERVICE = "studio"
  }
}

target "monitoring" {
  inherits   = ["node-base"]
  dockerfile = "docker/node.Dockerfile"
  tags       = ["${REGISTRY}/monitoring:${TAG}"]
  args = {
    SERVICE = "monitoring"
  }
}

target "distributor" {
  inherits   = ["node-base"]
  dockerfile = "docker/node.Dockerfile"
  tags       = ["${REGISTRY}/distributor:${TAG}"]
  args = {
    SERVICE = "distributor"
  }
}

target "analyst" {
  inherits   = ["node-base"]
  dockerfile = "docker/node.Dockerfile"
  tags       = ["${REGISTRY}/analyst:${TAG}"]
  args = {
    SERVICE = "analyst"
  }
}

# ----- 3 Python service images (per-agent Dockerfiles) --------------
target "style-learner" {
  inherits   = ["_common"]
  dockerfile = "agents/style-learner/Dockerfile"
  tags       = ["${REGISTRY}/style-learner:${TAG}"]
  args = {
    PYTHON_VERSION = "3.13"
  }
}

target "editor" {
  inherits   = ["_common"]
  dockerfile = "agents/editor/Dockerfile"
  tags       = ["${REGISTRY}/editor:${TAG}"]
  args = {
    PYTHON_VERSION = "3.13"
  }
}

target "video" {
  inherits   = ["_common"]
  dockerfile = "agents/video/Dockerfile"
  tags       = ["${REGISTRY}/video:${TAG}"]
  args = {
    PYTHON_VERSION = "3.13"
  }
}

# ----- groups: pick what to build with one flag ----------------------
group "all" {
  targets = [
    # 9 Node services
    "auth",
    "billing",
    "oauth",
    "ingest",
    "dashboard",
    "studio",
    "monitoring",
    "distributor",
    "analyst",
    # 3 Python services
    "style-learner",
    "editor",
    "video",
  ]
}

group "node-runtime" {
  targets = [
    "auth",
    "billing",
    "oauth",
    "ingest",
    "dashboard",
    "studio",
    "monitoring",
    "distributor",
    "analyst",
  ]
}

group "python-runtime" {
  targets = [
    "style-learner",
    "editor",
    "video",
  ]
}

# Convenience: build the 3 Python agents whose tests we run in CI.
group "ci-python" {
  targets = ["style-learner", "editor", "video"]
}

# Convenience: build the 9 Node agents whose tests we run in CI.
group "ci-node" {
  targets = [
    "auth",
    "billing",
    "oauth",
    "ingest",
    "dashboard",
    "studio",
    "monitoring",
    "distributor",
    "analyst",
  ]
}
