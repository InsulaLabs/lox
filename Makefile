.PHONY: all icons build clean build-linux build-windows build-darwin

ICON_SOURCE = assets/logo.png
BUILD_DIR = build
WINDOWS_DIR = $(BUILD_DIR)/windows
DARWIN_DIR = $(BUILD_DIR)/darwin

all: icons build

icons: prepare-dirs convert-icons

prepare-dirs:
	@echo "Creating build directories..."
	@mkdir -p $(WINDOWS_DIR)
	@mkdir -p $(DARWIN_DIR)

convert-icons: prepare-dirs
	@echo "Converting icons for all platforms..."
	@cp $(ICON_SOURCE) $(BUILD_DIR)/appicon.png
	@echo "Creating Windows ICO..."
	@convert $(ICON_SOURCE) -define icon:auto-resize=256,128,64,48,32,16 $(WINDOWS_DIR)/icon.ico || \
		echo "Error: ImageMagick not installed. Install with: sudo apt install imagemagick"
	@echo "Creating macOS ICNS..."
	@if command -v iconutil >/dev/null 2>&1; then \
		mkdir -p /tmp/iconset.iconset && \
		sips -z 16 16     $(ICON_SOURCE) --out /tmp/iconset.iconset/icon_16x16.png && \
		sips -z 32 32     $(ICON_SOURCE) --out /tmp/iconset.iconset/icon_16x16@2x.png && \
		sips -z 32 32     $(ICON_SOURCE) --out /tmp/iconset.iconset/icon_32x32.png && \
		sips -z 64 64     $(ICON_SOURCE) --out /tmp/iconset.iconset/icon_32x32@2x.png && \
		sips -z 128 128   $(ICON_SOURCE) --out /tmp/iconset.iconset/icon_128x128.png && \
		sips -z 256 256   $(ICON_SOURCE) --out /tmp/iconset.iconset/icon_128x128@2x.png && \
		sips -z 256 256   $(ICON_SOURCE) --out /tmp/iconset.iconset/icon_256x256.png && \
		sips -z 512 512   $(ICON_SOURCE) --out /tmp/iconset.iconset/icon_256x256@2x.png && \
		sips -z 512 512   $(ICON_SOURCE) --out /tmp/iconset.iconset/icon_512x512.png && \
		sips -z 1024 1024 $(ICON_SOURCE) --out /tmp/iconset.iconset/icon_512x512@2x.png && \
		iconutil -c icns /tmp/iconset.iconset -o $(DARWIN_DIR)/icon.icns && \
		rm -rf /tmp/iconset.iconset; \
	elif command -v png2icns >/dev/null 2>&1; then \
		png2icns $(DARWIN_DIR)/icon.icns $(ICON_SOURCE); \
	else \
		echo "Warning: No ICNS converter found. Install png2icns or build on macOS."; \
	fi

build: icons
	@echo "Building application..."
	wails build

build-linux: icons
	@echo "Building for Linux..."
	@echo "Building for current architecture..."
	wails build -o loxhaus-linux-$$(uname -m)
	@echo "Note: Cross-compilation requires -skipbindings flag"
	@echo "Building other architectures with -skipbindings..."
	@if [ "$$(uname -m)" = "x86_64" ]; then \
		echo "Building ARM64 version..."; \
		GOARCH=arm64 wails build -skipbindings -platform linux/arm64 -o loxhaus-linux-arm64; \
	else \
		echo "Building AMD64 version..."; \
		GOARCH=amd64 wails build -skipbindings -platform linux/amd64 -o loxhaus-linux-amd64; \
	fi

build-windows: icons
	@echo "Building for Windows..."
	wails build -platform windows/amd64 -o loxhaus-windows-amd64.exe

build-darwin: icons
	@echo "Building for macOS..."
	wails build -platform darwin/universal -o loxhaus-darwin-universal

clean:
	@echo "Cleaning build artifacts..."
	@rm -rf $(BUILD_DIR)/bin
	@rm -f $(BUILD_DIR)/appicon.png
	@rm -f $(WINDOWS_DIR)/icon.ico
	@rm -f $(DARWIN_DIR)/icon.icns
	@rm -rf frontend/dist

dev:
	wails dev

run: build
	./$(BUILD_DIR)/bin/loxhaus
