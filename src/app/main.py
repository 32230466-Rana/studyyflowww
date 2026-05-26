import streamlit as st


def main():
    st.set_page_config(page_title="Studyflow App")
    st.title("Studyflow — Minimal Streamlit Entry")
    st.write("This is a placeholder main.py. Replace with your app logic.")

    if st.button("Run test action"):
        st.success("Streamlit entrypoint is working.")


if __name__ == "__main__":
    main()
