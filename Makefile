#.PHONY: test e2e-test cover gofmt gofmt-fix header-check clean tar.gz docker-push release docker-push-all flannel-git

# Default tag and architecture. Can be overridden
#VERSION?=$(shell git describe --tags --dirty)
#ifeq ($(VERSION),)
#	VERSION=latest
#endif
#
#ifeq ($(findstring dirty,$(VERSION)), dirty)
#	VERSION=latest
#endif

VERSION=$(shell date +%Y%m%d-%H)


clean:
	@echo "clean"


## Create a docker image on disk for a specific arch and tag
#npm run update-language-files --language=zh-CN && export VERSION=$(VERSION) && npm run build-my-docker

image:
	export VERSION=$(VERSION) && npm run build-my-docker

