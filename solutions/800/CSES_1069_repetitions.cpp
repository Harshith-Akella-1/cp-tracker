// Repetitions (CSES, rating 800)
// https://cses.fi/problemset/task/1069
// Accepted 22/10/2026

#include <bits/stdc++.h>
using namespace std;

int main(){
    string str;
    cin >> str;

    long long currlen =1, maxlen=1;

    for(int i=1;i<str.length();i++){
        if(str[i] == str[i-1]){
            currlen++;
            maxlen = max(currlen, maxlen);
        }
        else{
            currlen=1;
        }

    }
    cout << maxlen << endl;

}