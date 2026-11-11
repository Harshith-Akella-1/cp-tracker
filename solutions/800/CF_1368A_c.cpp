// C+= (Codeforces, rating 800)
// https://codeforces.com/problemset/problem/1368/A
// Accepted 21/10/2026

#include <bits/stdc++.h>
using namespace std;

int main() {
    int t;
    cin >> t;

    while(t--){
        int a, b, n;
        cin >> a;
        cin >> b;
        cin >> n;

        int count=0;

        while(max(a, b) <= n){
            if (a>b){
                b+=a;
                count++;
            }

            else{
                a+=b;
                count++;
            }

        }
        cout << count << endl;
    }

    


    return 0;
}
