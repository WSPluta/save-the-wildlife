export const isForwardKeyPressed = (keyboard) => {
    return keyboard["ArrowUp"] || keyboard["KeyW"]
}

export const isReverseKeyPressed = (keyboard) => {
    return keyboard["ArrowDown"] || keyboard["KeyS"]
}

export const isLeftKeyPressed = (keyboard) => {
    return keyboard["ArrowLeft"] || keyboard["KeyA"]
}

export const isRightKeyPressed = (keyboard) => {
    return keyboard["ArrowRight"] || keyboard["KeyD"]
}