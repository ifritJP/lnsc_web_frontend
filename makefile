LNS_DIR=oss/LuneScript/src

help:
	@echo make help
	@echo make build

build:
	make -C $(LNS_DIR) build-wasm
	cp $(LNS_DIR)/lnsc.wasm .
