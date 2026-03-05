const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(length = 6): string {
  if (length < 3) {
    throw new Error("Room code length must be at least 3");
  }

  let code = "";
  for (let index = 0; index < length; index += 1) {
    const position = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[position];
  }

  return code;
}
