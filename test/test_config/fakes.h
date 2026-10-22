#pragma once

// newlib's allocating sprintf, which CFG_STRING_PTR uses.
int asiprintf(char** out, const char* format, ...);
