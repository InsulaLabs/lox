package main

import (
	"embed"
	"flag"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/fatih/color"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"gopkg.in/yaml.v2"

	"github.com/InsulaLabs/insi/ferry"
)

//go:embed all:frontend/dist
var assets embed.FS

var logger *slog.Logger
var installDir string
var requiresApiKey bool

type FerryConfig struct {
	ApiKeyEnv  string   `yaml:"api_key_env"`
	Endpoints  []string `yaml:"endpoints"`
	SkipVerify bool     `yaml:"skip_verify"`
	Timeout    string   `yaml:"timeout"`
	Domain     string   `yaml:"domain,omitempty"`
}

func main() {
	logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	var uninstall bool
	var debug bool
	var skipApiKey bool
	flag.BoolVar(&uninstall, "uninstall", false, "Uninstall the application")
	flag.BoolVar(&debug, "debug", false, "Enable debug logging")
	flag.BoolVar(&skipApiKey, "skip-api-key", false, "Skip API key check")
	flag.Parse()

	if debug {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
			Level: slog.LevelDebug,
		}))
		color.HiYellow("Debug logging enabled")
	}

	userHome, err := os.UserHomeDir()
	if err != nil {
		println("Error:", err.Error())
	}
	installDir = filepath.Join(userHome, "loxhaus")
	if uninstall {
		color.HiYellow("Uninstalling...")
		doUninstall()
		time.Sleep(1 * time.Second)
		color.HiGreen("Uninstalled")
		os.Exit(0)
	}

	color.HiYellow("Checking for configuration... %s", installDir)

	if !isInstalled() {
		install()
		time.Sleep(1 * time.Second)
		color.HiYellow("Installing configuration...")
		time.Sleep(1 * time.Second)
		color.HiGreen("Configuration installed")
	}

	cfg, err := loadConfig()
	if err != nil {
		color.HiRed("Error: %v", err)
		os.Exit(1)
	}

	insiApiKey := os.Getenv(cfg.ApiKeyEnv)
	if insiApiKey == "" && !skipApiKey && shouldCheckApiKey() {
		color.HiRed("API key not set")
		color.HiRed("Please set the API key in the environment variable %s", cfg.ApiKeyEnv)
		color.HiRed("You can find or create the API key in the Insula Labs' user dashboard: https://insulalabs.io")
		os.Exit(1)
	}

	color.HiGreen("Configuration loaded")

	ferryConfig := &ferry.Config{
		ApiKey:     os.Getenv(cfg.ApiKeyEnv),
		Endpoints:  cfg.Endpoints,
		SkipVerify: cfg.SkipVerify,
		Domain:     cfg.Domain,
	}

	ferryClient, err := ferry.New(logger, ferryConfig)
	if err != nil {
		color.HiRed("Error: %v", err)
		os.Exit(1)
	}

	if err := ferryClient.Ping(5, time.Second); err != nil {
		color.HiRed("Error: %v", err)
		os.Exit(1)
	}

	logger.Info("client connected")

	app := NewApp(logger, ferryClient)

	// Create application with options
	err = wails.Run(&options.App{
		Title:  "loxhaus",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

func generateConfig() []byte {
	endpointList := []string{
		"db-0.insula.dev:443",
		"db-1.insula.dev:443",
		"db-2.insula.dev:443",
	}

	cfg := FerryConfig{
		ApiKeyEnv:  "INSI_API_KEY",
		Endpoints:  endpointList,
		SkipVerify: false,
		Timeout:    "30s",
	}

	data, err := yaml.Marshal(&cfg)
	if err != nil {
		color.HiRed("Error: %v", err)
		os.Exit(1)
	}

	return data
}

func isInstalled() bool {
	info, err := os.Stat(installDir)
	if err != nil {
		return false
	}
	if !info.IsDir() {
		return false
	}
	if _, err := os.Stat(filepath.Join(installDir, "config.yaml")); err != nil {
		return false
	}
	return true
}

func install() {
	os.MkdirAll(installDir, 0755)
	os.WriteFile(filepath.Join(installDir, "config.yaml"), generateConfig(), 0644)
}

func loadConfig() (*FerryConfig, error) {
	data, err := os.ReadFile(filepath.Join(installDir, "config.yaml"))
	if err != nil {
		return nil, err
	}
	var cfg FerryConfig
	err = yaml.Unmarshal(data, &cfg)
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

func doUninstall() {
	os.RemoveAll(installDir)
}
