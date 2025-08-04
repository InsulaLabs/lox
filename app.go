package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"reflect"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/InsulaLabs/insi/client"
	"github.com/InsulaLabs/insi/ferry"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx         context.Context
	logger      *slog.Logger
	ferryClient *ferry.Ferry
	rawClient   *client.Client

	blobController ferry.BlobController

	subscriptions    map[string]context.CancelFunc
	subscriptionsMux sync.RWMutex
}

func NewApp(logger *slog.Logger, ferryClient *ferry.Ferry) *App {
	// Extract the raw client from ferry using reflection
	rawClient := extractRawClient(ferryClient)

	return &App{
		logger:         logger,
		ferryClient:    ferryClient,
		rawClient:      rawClient,
		blobController: ferry.GetBlobController(ferryClient),
		subscriptions:  make(map[string]context.CancelFunc),
	}
}

func extractRawClient(f *ferry.Ferry) *client.Client {
	// Use reflection to access the private client field
	ferryValue := reflect.ValueOf(f).Elem()
	clientField := ferryValue.FieldByName("client")

	// Use unsafe to access the unexported field
	clientPtr := reflect.NewAt(clientField.Type(), unsafe.Pointer(clientField.UnsafeAddr())).Elem()
	return clientPtr.Interface().(*client.Client)
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// withRateLimitRetry handles rate limit errors and retries the operation
func (a *App) withRateLimitRetry(operation func() error, operationName string, key string) error {
	maxRetries := 3
	for i := 0; i < maxRetries; i++ {
		err := operation()
		if err == nil {
			return nil
		}

		// Check if it's a rate limit error
		errStr := err.Error()
		if strings.Contains(errStr, "rate limited") || strings.Contains(errStr, "Too Many Requests") {
			// Extract wait time from error message
			waitTime := time.Second // default 1 second
			if strings.Contains(errStr, "Try again in") {
				// Parse the wait time if available
				var seconds int
				if _, scanErr := fmt.Sscanf(errStr, "%*[^0-9]%d", &seconds); scanErr == nil && seconds > 0 {
					waitTime = time.Duration(seconds) * time.Second
				}
			}

			if i < maxRetries-1 {
				a.logger.Warn("rate limited, retrying",
					"operation", operationName,
					"key", key,
					"attempt", i+1,
					"max_attempts", maxRetries,
					"wait_time", waitTime)
				time.Sleep(waitTime)
				continue
			}
		}
		return err
	}
	return fmt.Errorf("operation failed after %d retries", maxRetries)
}

func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

func (a *App) GetRequiresApiKey() bool {
	return requiresApiKey
}

type KeyListResult struct {
	Keys  []string `json:"keys"`
	Total int      `json:"total"`
}

func (a *App) SearchValues(prefix string, offset, limit int) (KeyListResult, error) {
	keys, err := a.rawClient.IterateByPrefix(prefix, offset, limit)
	if err != nil {
		a.logger.Error("failed to search values", "error", err)
		return KeyListResult{}, err
	}
	return KeyListResult{Keys: keys, Total: len(keys)}, nil
}

func (a *App) GetValue(key string) (string, error) {
	value, err := a.rawClient.Get(key)
	if err != nil {
		if err.Error() == "key not found" {
			return "", nil
		}
		a.logger.Error("failed to get value", "key", key, "error", err)
		return "", err
	}
	return value, nil
}

func (a *App) SetValue(key, value string) error {
	err := a.rawClient.Set(key, value)
	if err != nil {
		a.logger.Error("failed to set value", "key", key, "error", err)
	}
	return err
}

func (a *App) DeleteValue(key string) error {
	return a.withRateLimitRetry(func() error {
		return a.rawClient.Delete(key)
	}, "DeleteValue", key)
}

func (a *App) SearchCache(prefix string, offset, limit int) (KeyListResult, error) {
	keys, err := a.rawClient.IterateCacheByPrefix(prefix, offset, limit)
	if err != nil {
		a.logger.Error("failed to search cache", "error", err)
		return KeyListResult{}, err
	}
	return KeyListResult{Keys: keys, Total: len(keys)}, nil
}

func (a *App) GetCache(key string) (string, error) {
	value, err := a.rawClient.GetCache(key)
	if err != nil {
		if err.Error() == "key not found" {
			return "", nil
		}
		a.logger.Error("failed to get cache", "key", key, "error", err)
		return "", err
	}
	return value, nil
}

func (a *App) SetCache(key, value string) error {
	err := a.rawClient.SetCache(key, value)
	if err != nil {
		a.logger.Error("failed to set cache", "key", key, "error", err)
	}
	return err
}

func (a *App) DeleteCache(key string) error {
	return a.withRateLimitRetry(func() error {
		return a.rawClient.DeleteCache(key)
	}, "DeleteCache", key)
}

func (a *App) SearchBlobs(prefix string, offset, limit int) (KeyListResult, error) {
	keys, err := a.blobController.IterateByPrefix(a.ctx, prefix, offset, limit)
	if err != nil {
		a.logger.Error("failed to search blobs", "error", err)
		return KeyListResult{}, err
	}
	return KeyListResult{Keys: keys, Total: len(keys)}, nil
}

type BlobInfo struct {
	Key  string `json:"key"`
	Size int64  `json:"size"`
}

func (a *App) GetBlobInfo(key string) (string, error) {
	// For now, we need to download to get size
	// In a future version, the blob controller could provide metadata without downloading
	reader, err := a.blobController.Download(a.ctx, key)
	if err != nil {
		a.logger.Error("failed to get blob info", "key", key, "error", err)
		return "", err
	}
	defer reader.Close()

	// Count bytes without storing in memory
	size := int64(0)
	buffer := make([]byte, 32*1024) // 32KB buffer
	for {
		n, err := reader.Read(buffer)
		size += int64(n)
		if err == io.EOF {
			break
		}
		if err != nil {
			a.logger.Error("failed to read blob size", "key", key, "error", err)
			return "", err
		}
	}

	result := map[string]interface{}{
		"size": size,
	}

	jsonData, err := json.Marshal(result)
	if err != nil {
		return "", err
	}

	return string(jsonData), nil
}

func (a *App) DownloadBlob(key string) (string, error) {
	// This method would be used for actual file download in the future
	return a.GetBlobInfo(key)
}

func (a *App) DeleteBlob(key string) error {
	return a.withRateLimitRetry(func() error {
		return a.blobController.Delete(a.ctx, key)
	}, "DeleteBlob", key)
}

func (a *App) UploadBlob(key string) error {
	dialog, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select File to Upload",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "All Files",
				Pattern:     "*.*",
			},
		},
	})

	if err != nil {
		return fmt.Errorf("failed to open file dialog: %w", err)
	}

	if dialog == "" {
		return fmt.Errorf("no file selected")
	}

	file, err := os.Open(dialog)
	if err != nil {
		a.logger.Error("failed to open file", "path", dialog, "error", err)
		return fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	fileInfo, err := file.Stat()
	if err != nil {
		a.logger.Error("failed to stat file", "path", dialog, "error", err)
		return fmt.Errorf("failed to stat file: %w", err)
	}

	err = a.blobController.Upload(a.ctx, key, file, fileInfo.Name())
	if err != nil {
		a.logger.Error("failed to upload blob", "key", key, "error", err)
		return err
	}

	return nil
}

func (a *App) PublishEvent(topic string, data string) error {
	a.logger.Info("publishing event to server", "topic", topic, "data", data)
	err := a.rawClient.PublishEvent(topic, data)
	if err != nil {
		a.logger.Error("failed to publish event", "topic", topic, "error", err)
		return err
	}
	a.logger.Info("event published successfully", "topic", topic)
	return nil
}

func (a *App) PurgeAllSubscribers() (int, error) {
	count, err := a.rawClient.PurgeEventSubscriptionsAllNodes()
	if err != nil {
		a.logger.Error("failed to purge all subscribers", "error", err)
		return 0, err
	}
	return count, nil
}

type EventMessage struct {
	Topic     string    `json:"topic"`
	Data      string    `json:"data"`
	Timestamp time.Time `json:"timestamp"`
}

func (a *App) SubscribeToTopic(topic string) error {
	a.subscriptionsMux.Lock()
	defer a.subscriptionsMux.Unlock()

	if cancel, exists := a.subscriptions[topic]; exists {
		cancel()
		delete(a.subscriptions, topic)
	}

	ctx, cancel := context.WithCancel(a.ctx)
	a.subscriptions[topic] = cancel

	go func() {
		a.logger.Info("subscribing to topic", "topic", topic)
		err := a.rawClient.SubscribeToEvents(topic, ctx, func(data any) {
			a.logger.Info("event received from server", "topic", topic, "data", data)
			msg := EventMessage{
				Topic:     topic,
				Data:      fmt.Sprintf("%v", data),
				Timestamp: time.Now(),
			}
			runtime.EventsEmit(a.ctx, "event-received", msg)
		})

		if err != nil {
			a.logger.Error("subscription error", "topic", topic, "error", err)
			runtime.EventsEmit(a.ctx, "subscription-error", map[string]string{
				"topic": topic,
				"error": err.Error(),
			})
		}

		a.subscriptionsMux.Lock()
		delete(a.subscriptions, topic)
		a.subscriptionsMux.Unlock()
	}()

	return nil
}

func (a *App) UnsubscribeFromTopic(topic string) error {
	a.subscriptionsMux.Lock()
	defer a.subscriptionsMux.Unlock()

	if cancel, exists := a.subscriptions[topic]; exists {
		cancel()
		delete(a.subscriptions, topic)
	}

	return nil
}

func (a *App) GetActiveSubscriptions() []string {
	a.subscriptionsMux.RLock()
	defer a.subscriptionsMux.RUnlock()

	topics := make([]string, 0, len(a.subscriptions))
	for topic := range a.subscriptions {
		topics = append(topics, topic)
	}

	return topics
}

func (a *App) UnsubscribeFromAll() error {
	a.subscriptionsMux.Lock()
	defer a.subscriptionsMux.Unlock()

	for _, cancel := range a.subscriptions {
		cancel()
	}

	a.subscriptions = make(map[string]context.CancelFunc)

	return nil
}
