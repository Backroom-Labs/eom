// OTA chunk rule: which arriving chunks go to flash, which ask the client to resend, and which
// are dropped quietly. Shared by the BLE and Wi-Fi transports.

#include <unity.h>

#include "system/ota_rx.h"

static ota_rx_t rx;

void setUp(void) {
    ota_rx_reset(&rx);
}

void tearDown(void) {}

static void test_chunks_in_order_are_accepted(void) {
    TEST_ASSERT_EQUAL(OTA_RX_ACCEPT, ota_rx_chunk(&rx, 0, 100, 1000));
    TEST_ASSERT_EQUAL(OTA_RX_ACCEPT, ota_rx_chunk(&rx, 100, 100, 1000));
    TEST_ASSERT_EQUAL_size_t(200, rx.next_offset);
}

static void test_a_gap_asks_once_for_a_resend_and_drops_what_follows(void) {
    ota_rx_chunk(&rx, 0, 100, 1000);
    // The chunk at 100 was lost; the ones after it are still in flight.
    TEST_ASSERT_EQUAL(OTA_RX_RESEND, ota_rx_chunk(&rx, 200, 100, 1000));
    TEST_ASSERT_EQUAL(OTA_RX_DROP, ota_rx_chunk(&rx, 300, 100, 1000));
    TEST_ASSERT_EQUAL(OTA_RX_DROP, ota_rx_chunk(&rx, 400, 100, 1000));
    TEST_ASSERT_EQUAL_size_t(100, rx.next_offset);
    // The client rewinds to 100.
    TEST_ASSERT_EQUAL(OTA_RX_ACCEPT, ota_rx_chunk(&rx, 100, 100, 1000));
    // A later gap asks again.
    TEST_ASSERT_EQUAL(OTA_RX_RESEND, ota_rx_chunk(&rx, 900, 100, 1000));
}

static void test_the_right_chunk_that_doesnt_fit_asks_for_a_resend_every_time(void) {
    ota_rx_chunk(&rx, 0, 100, 1000);
    TEST_ASSERT_EQUAL(OTA_RX_RESEND, ota_rx_chunk(&rx, 100, 100, 50));
    TEST_ASSERT_EQUAL(OTA_RX_RESEND, ota_rx_chunk(&rx, 100, 100, 50));
    TEST_ASSERT_EQUAL_size_t(100, rx.next_offset);
    TEST_ASSERT_EQUAL(OTA_RX_ACCEPT, ota_rx_chunk(&rx, 100, 100, 100));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_chunks_in_order_are_accepted);
    RUN_TEST(test_a_gap_asks_once_for_a_resend_and_drops_what_follows);
    RUN_TEST(test_the_right_chunk_that_doesnt_fit_asks_for_a_resend_every_time);
    return UNITY_END();
}
