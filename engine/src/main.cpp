#include <iostream>
#include "renderer/renderer.hpp"
#include "input.hpp"

int main() {
    Character player;
    char cmd;

    std::cout << "Engine running. Use WASD to move, q to quit.\n";

    while (true) {
        render_frame();
        std::cout << "Command: ";
        std::cin >> cmd;
        if (cmd == 'q') break;
        move_character(player, cmd);
    }

    return 0;
}
