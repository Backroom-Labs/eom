// Fakes for what CONFIG_DEFS calls outside config.c.
#define _GNU_SOURCE  // vasprintf on glibc
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include "config_defs.h"
#include "fakes.h"

bool atob(const char* a) {
    return a != NULL && (!strcasecmp(a, "true") || !strcmp(a, "1"));
}

// newlib's allocating sprintf, which the host C library may not have.
int asiprintf(char** out, const char* format, ...) {
    va_list args;
    va_start(args, format);
    int len = vasprintf(out, format, args);
    va_end(args);
    return len;
}
