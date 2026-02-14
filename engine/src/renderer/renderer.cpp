#include <iostream>
#include "renderer.hpp"
#include "input.hpp"

void render_frame(const Character &c) {
    const int width = 5;
    const int height = 5;

    for (int y = height - 1; y >= 0; --y) {
        for (int x = 0; x < width; ++x) {
            if (x == c.x && y == c.y)
                std::cout << "@ ";
            else
                std::cout << ". ";
        }
        std::cout << std::endl;
    }
    std::cout << std::endl;
}
