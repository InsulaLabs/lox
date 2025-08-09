#!/bin/bash

set -e

echo "Building Loxhaus for multiple platforms..."

BUILD_DIR="build/bin"
mkdir -p "$BUILD_DIR"

CURRENT_OS=$(uname -s | tr '[:upper:]' '[:lower:]')
CURRENT_ARCH=$(uname -m)

if [ "$CURRENT_ARCH" = "x86_64" ]; then
    CURRENT_ARCH="amd64"
elif [ "$CURRENT_ARCH" = "aarch64" ]; then
    CURRENT_ARCH="arm64"
fi

if [ "$CURRENT_OS" = "darwin" ]; then
    CURRENT_PLATFORM="darwin"
else
    CURRENT_PLATFORM="linux"
fi

echo "Current platform: $CURRENT_PLATFORM/$CURRENT_ARCH"
echo ""

echo "Building for current platform ($CURRENT_PLATFORM/$CURRENT_ARCH)..."
SKIP_API_KEY_CHECK=true wails build -o "loxhaus-$CURRENT_PLATFORM-$CURRENT_ARCH"

if [ "$CURRENT_PLATFORM" = "linux" ]; then
    echo ""
    echo "Note: Cross-compilation from Linux to Windows/macOS requires additional setup:"
    echo "  - For Windows: Install mingw-w64 (sudo apt install mingw-w64)"
    echo "  - For macOS: Requires osxcross toolchain"
    echo ""
    echo "Attempting Linux builds only..."
    
    if [ "$CURRENT_ARCH" = "amd64" ]; then
        echo "Building for Linux ARM64..."
        SKIP_API_KEY_CHECK=true GOARCH=arm64 wails build -skipbindings -o "loxhaus-linux-arm64" || echo "Linux ARM64 build failed (may need cross-compilation tools)"
    else
        echo "Building for Linux AMD64..."
        SKIP_API_KEY_CHECK=true GOARCH=amd64 wails build -skipbindings -o "loxhaus-linux-amd64" || echo "Linux AMD64 build failed (may need cross-compilation tools)"
    fi
    
    echo ""
    echo "To build for Windows, you can:"
    echo "1. Use a Windows machine with Wails installed"
    echo "2. Use GitHub Actions or other CI/CD platforms"
    echo "3. Set up cross-compilation tools (complex setup)"
    
elif [ "$CURRENT_PLATFORM" = "darwin" ]; then
    echo ""
    echo "Building for macOS universal binary..."
    SKIP_API_KEY_CHECK=true wails build -platform darwin/universal -o "loxhaus-darwin-universal"
    
    echo ""
    echo "To build for Windows/Linux from macOS:"
    echo "  - Use Docker with Linux environment"
    echo "  - Use CI/CD platforms"
fi

echo ""
echo "Build completed!"
echo "Binaries are located in: build/bin/"
echo ""
ls -la build/bin/
echo ""
echo "For full cross-platform builds, consider using:"
echo "  - GitHub Actions workflow"
echo "  - Docker containers for each platform"
echo "  - Dedicated build machines for each OS"