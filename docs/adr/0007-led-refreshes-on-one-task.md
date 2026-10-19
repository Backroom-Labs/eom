# All LED refreshes run on one task pinned to core 0

WS2812/SK6812 refreshes all run in a single `LED` task pinned to core 0, which also creates the RMT channel; `eom_hal_set_rgb()` only queues the colour. Refreshing from the other core raced the RMT TX-done interrupt and left the channel stuck, so don't refresh the LED directly from other tasks.
