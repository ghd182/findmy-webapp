# app/auth/forms.py
# NEW FILE
from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, BooleanField, SubmitField, EmailField
from wtforms.validators import DataRequired, Length, Email, EqualTo, ValidationError
import logging

from app.models import User  # To check if username/email exists

log = logging.getLogger(__name__)


class LoginForm(FlaskForm):
    username = StringField(
        "Username", validators=[DataRequired(), Length(min=3, max=64)]
    )
    password = PasswordField("Password", validators=[DataRequired()])
    remember = BooleanField("Remember Me")
    submit = SubmitField("Login")


class RegistrationForm(FlaskForm):
    username = StringField(
        "Username", validators=[DataRequired(), Length(min=3, max=64)]
    )
    email = EmailField("Email", validators=[DataRequired(), Email(), Length(max=120)])
    password = PasswordField(
        "Password",
        validators=[
            DataRequired(),
            Length(min=8, message="Password must be at least 8 characters long."),
        ],
    )
    confirm_password = PasswordField(
        "Confirm Password",
        validators=[
            DataRequired(),
            EqualTo("password", message="Passwords must match."),
        ],
    )
    submit = SubmitField("Register")

    # Custom validators to check if username/email already exists
    def validate_username(self, username):
        user = User.get(username.data)
        if user is not None:
            log.warning(
                f"Registration validation failed: Username '{username.data}' already exists."
            )
            raise ValidationError(
                "Username already taken. Please choose a different one."
            )

    def validate_email(self, email):
        # Need access to UserDataService here, which is tricky without app context.
        # For simplicity in this form, we'll skip the email uniqueness check here
        # and rely on the check within the route function (which has app context).
        # A more advanced setup might pass the UDS instance or use application factories.
        log.debug(
            f"Skipping email uniqueness check within RegistrationForm for {email.data}"
        )
        pass


class AppleCredentialsForm(FlaskForm):
    apple_id = EmailField(
        "Apple ID", validators=[DataRequired(), Email(), Length(max=120)]
    )
    apple_password = PasswordField(
        "Apple Password",
        validators=[DataRequired(message="Password is required to save changes.")],
    )
    submit = SubmitField("Save Credentials")
