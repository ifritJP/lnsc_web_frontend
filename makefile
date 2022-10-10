LNS_DIR=oss/LuneScript

help:
	@echo make help
	@echo make build

build:
	(cd $(LNS_DIR) && git reset --hard remotes/origin/master)
	make -C $(LNS_DIR)/src build-wasm
	cp $(LNS_DIR)/src/lnsc.wasm for_wasm/
	zip for_wasm/lnsc.zip for_wasm/lnsc.wasm 
