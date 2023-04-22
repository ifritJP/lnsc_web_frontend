LNS_DIR=oss/LuneScript

ifneq "$(wildcard Makefile.local)" ""
include Makefile.local
endif


help:
	@echo make help
	@echo make build

build:
#	(cd $(LNS_DIR) && git reset --hard remotes/origin/master && git pull)
	(cd $(LNS_DIR) && git pull)
ifdef QUIC
	make -C $(LNS_DIR)/src build-wasm-quick
else
	make -C $(LNS_DIR)/src build-wasm
endif
	cp $(LNS_DIR)/src/lnsc.wasm for_wasm/
	zip for_wasm/lnsc.zip for_wasm/lnsc.wasm 
