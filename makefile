LNS_DIR=oss/LuneScript/src

help:
	@echo make help
	@echo make build

build:
	make -C $(LNS_DIR) build-wasm
	cp $(LNS_DIR)/lnsc.wasm for_wasm/
	zip for_wasm/lnsc.zip for_wasm/lnsc.wasm 
