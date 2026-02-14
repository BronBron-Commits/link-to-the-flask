#include <iostream>

struct Character {
    int x = 0;
    int y = 0;
};

void move_character(Character &c, char dir) {
    switch(dir) {
        case 'w': c.y += 1; break;
        case 's': c.y -= 1; break;
        case 'a': c.x -= 1; break;
        case 'd': c.x += 1; break;
    }
    std::cout << "Character at (" << c.x << "," << c.y << ")" << std::endl;
}
