#pragma once

struct Character {
    int x = 0;
    int y = 0;
};

void move_character(Character &c, char dir);
