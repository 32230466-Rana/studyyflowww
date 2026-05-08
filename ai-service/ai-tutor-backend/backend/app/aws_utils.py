import boto3
import os

s3 = boto3.client('s3')

def upload_to_s3(filename, file_bytes):
    bucket = os.getenv("S3_BUCKET")
    s3.put_object(Bucket=bucket, Key=f"uploads/{filename}", Body=file_bytes)