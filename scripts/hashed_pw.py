from werkzeug.security import generate_password_hash
password = 'user1_password' # Replace with a strong password
hashed_password = generate_password_hash(password)
print(hashed_password)