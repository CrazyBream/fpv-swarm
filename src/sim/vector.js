export class Vector2 {
	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}

	add(other) {
		return new Vector2(this.x + other.x, this.y + other.y);
	}

	sub(other) {
		return new Vector2(this.x - other.x, this.y - other.y);
	}

	scale(scalar) {
		return new Vector2(this.x * scalar, this.y * scalar);
	}

	length() {
		return Math.hypot(this.x, this.y);
	}

	normalize() {
		const len = this.length();
		if (len === 0) return new Vector2(0, 0);
		return new Vector2(this.x / len, this.y / len);
	}

	rotate(angleRad) {
		const cos = Math.cos(angleRad);
		const sin = Math.sin(angleRad);
		return new Vector2(
			this.x * cos - this.y * sin,
			this.x * sin + this.y * cos,
		);
	}

	dot(other) {
		return this.x * other.x + this.y * other.y;
	}

	clone() {
		return new Vector2(this.x, this.y);
	}

	addInPlace(other) {
		this.x += other.x;
		this.y += other.y;
		return this;
	}

	scaleInPlace(scalar) {
		this.x *= scalar;
		this.y *= scalar;
		return this;
	}

	static fromAngle(angleRad, length = 1) {
		return new Vector2(
			Math.cos(angleRad) * length,
			Math.sin(angleRad) * length,
		);
	}
}
